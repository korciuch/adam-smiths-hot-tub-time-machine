"""Reads and writes the committed CSV dataset in the repo's `data/` directory.

The dataset exists so a clone can serve real prices without a Twelve Data key.
The vendor backfill is rate-limited to 8 req/min and capped at 800 req/day, so a
full 503-ticker pass costs ~70 minutes and most of a day's quota -- not something
to repeat per checkout.

One CSV per ticker rather than one big file: it keeps every file to a few hundred
KB, makes re-ingesting a single company a one-file diff, and lets `ls` answer
what we have. Uncompressed, because git zlib-compresses blobs in the pack anyway
-- gzipping would cost the same on disk and give up diffability.
"""
import csv
import datetime
from itertools import groupby
from pathlib import Path
from typing import Dict, Iterable, Iterator, List, Optional, Tuple

from sqlalchemy import func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert

from .. import models

DATA_DIR = Path(__file__).resolve().parents[3] / "data"
COMPANIES_CSV = DATA_DIR / "companies.csv"
PRICES_DIR = DATA_DIR / "prices"

COMPANY_COLUMNS = ["ticker", "name", "sector"]
# No ticker column: the filename carries it. Across ~2.3M rows that's ~12MB of
# repeated symbol saved.
PRICE_COLUMNS = ["date", "open", "high", "low", "close", "volume"]

# Rows per INSERT. Large enough that statement overhead disappears, small enough
# to stay well under SQLite's variable limit at 6 columns per row.
BATCH_ROWS = 5_000


def export_dataset(db, out_dir: Optional[Path] = None) -> Dict[str, int]:
    """Writes `companies.csv` and one `prices/<TICKER>.csv` per company.

    Rows are sorted by date and files named by ticker so that re-exporting an
    unchanged database produces no diff.
    """
    data_dir = Path(out_dir) if out_dir else DATA_DIR
    prices_dir = data_dir / "prices"
    prices_dir.mkdir(parents=True, exist_ok=True)

    companies = db.scalars(select(models.Company).order_by(models.Company.ticker)).all()
    _write_csv(
        data_dir / "companies.csv",
        COMPANY_COLUMNS,
        ([c.ticker, c.name, c.sector or ""] for c in companies),
    )

    ticker_by_id = {c.id: c.ticker for c in companies}
    written: Dict[str, int] = {}

    # One pass over `prices` ordered by (company_id, date), split into files as
    # the company changes. Querying per ticker would be 503 round trips.
    rows = db.execute(
        select(
            models.Price.company_id,
            models.Price.date,
            models.Price.open,
            models.Price.high,
            models.Price.low,
            models.Price.close,
            models.Price.volume,
        ).order_by(models.Price.company_id, models.Price.date)
    )
    for company_id, group in _group_by_company(rows):
        ticker = ticker_by_id.get(company_id)
        if ticker is None:  # price rows for a deleted company
            continue
        count = _write_csv(
            prices_dir / f"{ticker}.csv",
            PRICE_COLUMNS,
            ([r.date.isoformat(), r.open, r.high, r.low, r.close, r.volume] for r in group),
        )
        written[ticker] = count

    pruned = _prune_stale(prices_dir, keep=set(written))
    return {
        "companies": len(companies),
        "tickers_with_prices": len(written),
        "price_rows": sum(written.values()),
        "files_pruned": pruned,
    }


def load_dataset(
    db,
    data_dir: Optional[Path] = None,
    tickers: Optional[List[str]] = None,
    years: Optional[float] = None,
) -> Dict[str, int]:
    """Loads the CSV dataset into the database. Safe to re-run.

    `years` keeps only the most recent N years of bars -- a dev convenience, so
    a local setup doesn't wait on the full history.
    """
    data_dir = Path(data_dir) if data_dir else DATA_DIR
    companies_csv = data_dir / "companies.csv"
    prices_dir = data_dir / "prices"
    if not companies_csv.exists():
        raise FileNotFoundError(f"No dataset at {data_dir}. Run scripts/export_dataset.py first.")

    company_stats = _load_companies(db, companies_csv)
    company_id_by_ticker = {
        row.ticker: row.id for row in db.execute(select(models.Company.ticker, models.Company.id))
    }

    wanted = {t.strip().upper() for t in tickers} if tickers else None
    # Approximate on purpose -- this only bounds how much history to read.
    cutoff = (
        datetime.date.today() - datetime.timedelta(days=round(365.25 * years)) if years else None
    )

    before = db.scalar(select(func.count()).select_from(models.Price)) or 0
    rows_read = 0

    for path in sorted(prices_dir.glob("*.csv")) if prices_dir.is_dir() else []:
        ticker = path.stem  # dots survive: "BRK.B.csv" -> "BRK.B"
        if wanted and ticker not in wanted:
            continue
        company_id = company_id_by_ticker.get(ticker)
        if company_id is None:
            print(f"  skipping {path.name}: no company row for {ticker}")
            continue
        rows_read += _insert_price_file(db, path, company_id, cutoff)

    db.commit()
    after = db.scalar(select(func.count()).select_from(models.Price)) or 0

    return {
        **company_stats,
        "rows_read": rows_read,
        "rows_inserted": after - before,
        "rows_skipped": rows_read - (after - before),
    }


def _load_companies(db, path: Path) -> Dict[str, int]:
    existing = {c.ticker: c for c in db.scalars(select(models.Company))}
    created = 0
    updated = 0

    with path.open(newline="") as handle:
        for row in csv.DictReader(handle):
            ticker = row["ticker"]
            sector = row["sector"] or None  # Company.sector is nullable
            company = existing.get(ticker)
            if company is None:
                db.add(models.Company(ticker=ticker, name=row["name"], sector=sector))
                created += 1
            elif company.name != row["name"] or company.sector != sector:
                company.name = row["name"]
                company.sector = sector
                updated += 1

    db.commit()
    return {"companies_created": created, "companies_updated": updated}


def _insert_price_file(db, path: Path, company_id: int, cutoff: Optional[datetime.date]) -> int:
    """Inserts one ticker's CSV, ignoring rows already present. Returns rows read."""
    # on_conflict_do_nothing against uq_price_company_date is what makes a
    # re-run a no-op instead of an IntegrityError.
    statement = sqlite_insert(models.Price.__table__).on_conflict_do_nothing(
        index_elements=["company_id", "date"]
    )

    rows_read = 0
    batch: List[dict] = []
    with path.open(newline="") as handle:
        for row in csv.DictReader(handle):
            bar_date = datetime.date.fromisoformat(row["date"])
            if cutoff and bar_date < cutoff:
                continue
            rows_read += 1
            batch.append(
                {
                    "company_id": company_id,
                    "date": bar_date,
                    "open": float(row["open"]),
                    "high": float(row["high"]),
                    "low": float(row["low"]),
                    "close": float(row["close"]),
                    "volume": int(row["volume"]),
                }
            )
            if len(batch) >= BATCH_ROWS:
                db.execute(statement, batch)
                batch.clear()

    if batch:
        db.execute(statement, batch)
    return rows_read


def _write_csv(path: Path, header: List[str], rows: Iterable[list]) -> int:
    count = 0
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        for row in rows:
            writer.writerow(row)
            count += 1
    return count


def _group_by_company(rows) -> Iterator[Tuple[int, Iterator]]:
    """groupby over the streaming result, keyed on company_id."""
    return groupby(rows, key=lambda row: row.company_id)


def _prune_stale(prices_dir: Path, keep: set) -> int:
    """Deletes price files for tickers the database no longer has.

    Without this, a company dropped from the index leaves its CSV behind
    forever and the loader keeps resurrecting it.
    """
    pruned = 0
    for path in prices_dir.glob("*.csv"):
        if path.stem not in keep:
            path.unlink()
            pruned += 1
    return pruned
