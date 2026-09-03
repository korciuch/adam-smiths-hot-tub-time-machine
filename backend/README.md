# Backend

FastAPI + SQLite (SQLAlchemy + Alembic).

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
python scripts/load_dataset.py
```

`load_dataset.py` reads the real S&P 500 prices committed under `data/`. No API
key, no network, ~15 seconds. This is how you get data.

```bash
python scripts/load_dataset.py --years 1        # last year only, if you want it smaller
python scripts/load_dataset.py --tickers AAPL,MSFT
python seed.py                                  # synthetic bars, no dataset needed
```

Re-running is a no-op: inserts conflicting with `uq_price_company_date` are
skipped, so it will not duplicate or overwrite.

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

- API: http://localhost:8000
- OpenAPI schema (for frontend type-gen): http://localhost:8000/openapi.json

## AI queries

There is no LLM here. The browser's WebLLM model writes the SQL; this service
only executes it, via `POST /ai/execute-sql` -> `{columns, rows, truncated, error}`.

That endpoint takes SQL from an untrusted client — the browser is not a trust
boundary and anything can POST to it directly — so it is guarded in three
independent layers: a sqlglot parse that admits only a single SELECT over
`companies`/`prices`/`notes` (`app/sql_guard.py`), a connection opened `mode=ro`
with `PRAGMA query_only` (`app/readonly.py`), and a 1000-row cap plus a 5s
interrupt. A rejected or failing query is a 200 with `error` set, not a 4xx: the
client feeds that message back to the model for a correction pass, so it is
ordinary control flow.

Verify all three layers, including the writes the read-only connection must
refuse even if the parser is assumed bypassed:

```bash
python scripts/check_sql_guard.py
```

## Migrations

```bash
alembic revision --autogenerate -m "message"
alembic upgrade head
```

## Refreshing the dataset

Only needed to pull newer prices from the vendor. Requires a free Twelve Data
key in `backend/.env` as `TWELVE_DATA_API_KEY`.

```bash
python scripts/ingest_constituents.py   # ticker/name/sector from Wikipedia, no key
python scripts/backfill_prices.py       # daily bars from Twelve Data
python scripts/export_dataset.py        # write data/ back out, then commit the diff
```

The backfill takes ~90 minutes for the full index and spends one API credit per
ticker, including tickers already stored. The free tier allows 8 requests/min
and 800/day, which a full pass fits but does not leave much room in — this is
the reason the dataset is committed rather than fetched per checkout.

History is capped by the vendor at 5000 daily bars per request, so anything
listed before late 2006 starts at 2006-10-18 and anything newer is complete from
its first trading day (ABBV from the 2013 spinoff, ABNB from the 2020 IPO).
Reaching further back needs `start_date`/`end_date` paging, which
`app/ingest/vendors/twelvedata.py` does not do.

## The `data/` directory

```
data/companies.csv      ticker,name,sector
data/prices/AAPL.csv    date,open,high,low,close,volume
```

One file per ticker, uncompressed. The ticker is the filename rather than a
column, which saves ~12MB across the set. Uncompressed because git zlib-compresses
blobs in the pack anyway, so gzipping would cost the same and give up diffability.

A prebuilt SQLite file is not an option: `.gitignore` excludes `*.db`, and the
full database is well past GitHub's 100MB per-file limit.
