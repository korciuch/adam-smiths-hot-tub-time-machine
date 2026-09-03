"""Backfills historical daily prices for companies already in the DB.

Rate-limited to stay under Twelve Data's free tier (8 req/min). Safe to
re-run: skips (company, date) pairs already stored.
"""
import time
from datetime import date as date_cls
from typing import Dict, List, Optional

from .. import models
from .vendors.twelvedata import fetch_daily_series

DEFAULT_DELAY_SECONDS = 8.0  # ~7.5 req/min, safely under the 8 req/min free-tier cap


def backfill_prices(
    db,
    api_key: str,
    tickers: Optional[List[str]] = None,
    delay_seconds: float = DEFAULT_DELAY_SECONDS,
    only_missing: bool = False,
) -> Dict[str, list]:
    query = db.query(models.Company)
    if tickers:
        wanted = {t.upper() for t in tickers}
        query = query.filter(models.Company.ticker.in_(wanted))
    if only_missing:
        # A company we already have bars for costs an API credit to re-fetch and
        # adds nothing. At 800 credits/day and ~12s per call, skipping them is
        # what makes an interrupted run cheap to resume.
        stored = db.query(models.Price.company_id).distinct()
        query = query.filter(~models.Company.id.in_(stored))
    companies = query.order_by(models.Company.ticker).all()

    results: Dict[str, list] = {"succeeded": [], "failed": []}

    for i, company in enumerate(companies):
        try:
            bars = fetch_daily_series(company.ticker, api_key=api_key)
        except Exception as exc:  # defensive: never let one bad ticker kill the run
            results["failed"].append({"ticker": company.ticker, "error": str(exc)})
            _sleep_between(i, len(companies), delay_seconds)
            continue

        try:
            added = _store_bars(db, company, bars)
        except Exception as exc:  # a duplicate date shouldn't cost us the rest of the run
            db.rollback()
            results["failed"].append({"ticker": company.ticker, "error": str(exc)})
            _sleep_between(i, len(companies), delay_seconds)
            continue

        results["succeeded"].append({"ticker": company.ticker, "bars_added": added})
        _sleep_between(i, len(companies), delay_seconds)

    return results


def _store_bars(db, company, bars: List[Dict]) -> int:
    """Inserts bars we don't already have, returning how many were added."""
    seen = {
        row.date
        for row in db.query(models.Price.date).filter(models.Price.company_id == company.id)
    }

    added = 0
    for bar in bars:
        bar_date = date_cls.fromisoformat(bar["date"])
        # `seen` grows as we go. Twelve Data has returned the same date twice in
        # one response (ARES, 2014-05-02), and a set seeded only from the DB
        # can't catch that -- both rows pass the check and the second one trips
        # the unique constraint.
        if bar_date in seen:
            continue
        seen.add(bar_date)
        db.add(
            models.Price(
                company_id=company.id,
                date=bar_date,
                open=bar["open"],
                high=bar["high"],
                low=bar["low"],
                close=bar["close"],
                volume=bar["volume"],
            )
        )
        added += 1

    db.commit()
    return added


def _sleep_between(i: int, total: int, delay_seconds: float) -> None:
    if i < total - 1:
        time.sleep(delay_seconds)
