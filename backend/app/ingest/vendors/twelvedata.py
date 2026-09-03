"""Minimal client for Twelve Data's `time_series` endpoint.

Free tier: 8 requests/min, 800 requests/day. One call returns up to 5000
daily bars (~19+ years) for a single symbol, costing 1 API credit -- so a
full S&P 500 backfill is ~500 calls total, comfortably under the daily cap.

Docs: https://twelvedata.com/docs
"""
from typing import Dict, List

import requests

BASE_URL = "https://api.twelvedata.com/time_series"


class TwelveDataError(RuntimeError):
    pass


def fetch_daily_series(ticker: str, api_key: str, outputsize: int = 5000) -> List[Dict]:
    """Returns daily OHLCV bars for `ticker`, oldest first.

    Each bar: {"date": "YYYY-MM-DD", "open": float, "high": float,
    "low": float, "close": float, "volume": int}
    """
    params = {
        "symbol": ticker,
        "interval": "1day",
        "outputsize": outputsize,
        "apikey": api_key,
    }
    resp = requests.get(BASE_URL, params=params, timeout=30)
    resp.raise_for_status()
    payload = resp.json()

    if payload.get("status") == "error":
        raise TwelveDataError(f"{ticker}: {payload.get('message', 'unknown error')}")

    values = payload.get("values") or []
    bars = []
    for row in values:
        bars.append(
            {
                "date": row["datetime"][:10],
                "open": float(row["open"]),
                "high": float(row["high"]),
                "low": float(row["low"]),
                "close": float(row["close"]),
                "volume": int(float(row.get("volume") or 0)),
            }
        )
    bars.reverse()  # API returns newest-first
    return bars
