#!/usr/bin/env python3
"""Syncs the S&P 500 constituent list (ticker/name/sector) from Wikipedia
into the `companies` table.

Usage:
    python scripts/ingest_constituents.py
"""
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))

from app.database import SessionLocal  # noqa: E402
from app.ingest.constituents import sync_companies  # noqa: E402


def main():
    db = SessionLocal()
    try:
        result = sync_companies(db)
        print(f"Constituents synced: {result}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
