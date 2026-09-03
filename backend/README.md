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

## Coverage

`data/` currently holds **304 of the 503 companies**, 1,386,102 daily bars. Every
file in it is complete for its ticker; what's missing is whole tickers, from
`META` onward alphabetically. The rest is a matter of API quota, not code —
see the resume step below.

`GET /companies` returns all 503 either way, because the constituent list is
scraped separately and costs nothing. A company with no bars charts as an empty
plot, which the UI labels rather than hiding.

## ETL

Three stages, each independently re-runnable. Only stage 2 needs an API key, and
only stage 2 costs anything.

```
Wikipedia ──1──> companies table ──┐
                                   ├──> data/*.csv ──3'──> any clone's DB
Twelve Data ──2──> prices table ───┘
```

### 1. Constituents — who is in the index

```bash
python scripts/ingest_constituents.py
```

Scrapes ticker/name/sector from Wikipedia's maintained table. No key, one HTTP
request, seconds. Upserts by ticker, so re-running only writes what changed.

Tickers use dot notation (`BRK.B`, `BF.B`). Twelve Data accepts that form
directly despite what the note in `app/ingest/constituents.py` warns about, and
the dot survives the CSV filename round-trip.

### 2. Prices — the expensive stage

Requires a free Twelve Data key in `backend/.env` as `TWELVE_DATA_API_KEY`.

```bash
python scripts/backfill_prices.py --only-missing   # resume: only companies with no bars
python scripts/backfill_prices.py                  # everything, re-fetching what we have
python scripts/backfill_prices.py --tickers AAPL,MSFT
```

**Use `--only-missing` to resume.** A plain run re-fetches every ticker including
ones already stored, which is a wasted credit and ~12 seconds each.

Budget: one credit per ticker, 8 requests/min and 800 credits/day on the free
tier. Reckon ~12s per ticker in practice — the request itself is ~1MB of JSON on
top of the 8s rate-limit sleep. So the 199 companies still missing are ~40
minutes and ~199 credits, and a full 503-ticker pass is ~90 minutes and most of a
day's quota. That cost is the whole reason `data/` is committed instead of
fetched per checkout.

The run is resumable by design: it commits per ticker, so interrupting it loses
at most the ticker in flight. A ticker that errors is recorded and skipped, and
printed as `FAILED <ticker>: <error>` at the end — check for those and re-run
with `--only-missing`.

History is capped by the vendor at 5000 daily bars per request, so anything
listed before late 2006 starts around 2006-10-17 and anything newer is complete
from its first trading day (ABBV from the 2013 spinoff, ABNB from the 2020 IPO).
Reaching further back needs `start_date`/`end_date` paging, which
`app/ingest/vendors/twelvedata.py` does not do.

### 3. Export — DB to `data/`

```bash
python scripts/export_dataset.py
```

Then commit the diff. Rows are sorted by date and files named by ticker, so
re-exporting an unchanged database produces no diff at all. Files for tickers
that have left the index are deleted, otherwise the loader would keep
resurrecting them.

### 3'. Load — `data/` to DB

The inverse, and the only stage most people run. See [Setup](#setup).

## The `data/` directory

```
data/companies.csv      ticker,name,sector
data/prices/AAPL.csv    date,open,high,low,close,volume
```

One file per ticker: each stays a few hundred KB, a re-ingested company is a
one-file diff, and `ls` answers what we have.

The ticker is the filename rather than a column, which saves ~7MB across the
current 1.39M rows. Left uncompressed because git zlib-compresses blobs in the
pack anyway — measured at 48 bytes/row on disk against 18 bytes/row in `.git`, so
gzipping would cost the same and give up diffability and greppability.

A prebuilt SQLite file is not an option: `.gitignore` excludes `*.db`, and the
database is well past GitHub's 100MB per-file limit. Largest CSV so far is 290KB.
