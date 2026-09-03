#!/usr/bin/env python3
"""Backfills historical daily prices from Twelve Data for companies in the DB.

Usage:
    export TWELVE_DATA_API_KEY=your_key_here
    python scripts/backfill_prices.py                  # all companies
    python scripts/backfill_prices.py --tickers AAPL,MSFT
    python scripts/backfill_prices.py --delay 8
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
except ImportError:
    pass

from app.database import SessionLocal  # noqa: E402
from app.ingest.backfill import DEFAULT_DELAY_SECONDS, backfill_prices  # noqa: E402


def parse_args():
    parser = argparse.ArgumentParser(description="Backfill historical daily prices from Twelve Data.")
    parser.add_argument("--tickers", default=None, help="Comma-separated tickers (default: all companies in DB).")
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY_SECONDS, help="Seconds between API calls.")
    parser.add_argument("--api-key", default=None, help="Overrides TWELVE_DATA_API_KEY env var.")
    return parser.parse_args()


def main():
    args = parse_args()
    api_key = args.api_key or os.environ.get("TWELVE_DATA_API_KEY")
    if not api_key:
        sys.exit(
            "No API key provided. Set TWELVE_DATA_API_KEY in backend/.env or pass --api-key.\n"
            "Get a free key at https://twelvedata.com/pricing"
        )

    tickers = [t.strip() for t in args.tickers.split(",")] if args.tickers else None

    db = SessionLocal()
    try:
        result = backfill_prices(db, api_key=api_key, tickers=tickers, delay_seconds=args.delay)
        print(f"Succeeded: {len(result['succeeded'])}, Failed: {len(result['failed'])}")
        for failure in result["failed"]:
            print(f"  FAILED {failure['ticker']}: {failure['error']}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
