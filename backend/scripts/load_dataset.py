#!/usr/bin/env python3
"""Loads the committed CSV dataset in `data/` into the database.

This is the normal way to get data. No API key, no network -- the prices are in
the repo. `backfill_prices.py` is only for refreshing them.

Usage:
    alembic upgrade head
    python scripts/load_dataset.py                 # full history, all tickers
    python scripts/load_dataset.py --years 1       # just the last year
    python scripts/load_dataset.py --tickers AAPL,MSFT
"""
import argparse
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal  # noqa: E402
from app.ingest.dataset import DATA_DIR, load_dataset  # noqa: E402


def parse_args():
    parser = argparse.ArgumentParser(description="Load the committed CSV dataset into the DB.")
    parser.add_argument("--data-dir", default=None, help=f"Dataset directory (default: {DATA_DIR}).")
    parser.add_argument("--tickers", default=None, help="Comma-separated tickers (default: all).")
    parser.add_argument("--years", type=float, default=None, help="Keep only the last N years.")
    return parser.parse_args()


def main():
    args = parse_args()
    tickers = args.tickers.split(",") if args.tickers else None

    db = SessionLocal()
    try:
        result = load_dataset(db, data_dir=args.data_dir, tickers=tickers, years=args.years)
    finally:
        db.close()

    print(
        f"Companies: {result['companies_created']} created, "
        f"{result['companies_updated']} updated"
    )
    print(
        f"Prices: {result['rows_inserted']:,} inserted, "
        f"{result['rows_skipped']:,} already present"
    )


if __name__ == "__main__":
    main()
