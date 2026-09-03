#!/usr/bin/env python3
"""Writes the database out to the committed CSV dataset in `data/`.

Run this after a backfill, then commit the diff.

Usage:
    python scripts/export_dataset.py
    python scripts/export_dataset.py --out /tmp/dataset
"""
import argparse
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal  # noqa: E402
from app.ingest.dataset import DATA_DIR, export_dataset  # noqa: E402


def parse_args():
    parser = argparse.ArgumentParser(description="Export the price database to CSV.")
    parser.add_argument("--out", default=None, help=f"Output directory (default: {DATA_DIR}).")
    return parser.parse_args()


def main():
    args = parse_args()
    db = SessionLocal()
    try:
        result = export_dataset(db, out_dir=args.out)
    finally:
        db.close()

    print(
        f"Exported {result['price_rows']:,} price rows for "
        f"{result['tickers_with_prices']} of {result['companies']} companies"
    )
    if result["files_pruned"]:
        print(f"Pruned {result['files_pruned']} file(s) for tickers no longer in the database")


if __name__ == "__main__":
    main()
