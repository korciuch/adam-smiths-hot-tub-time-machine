"""Fetches the current S&P 500 constituent list from Wikipedia.

Wikipedia's maintained table is a pragmatic free source for (ticker, name,
sector) triples. It does not have a public API of its own for this data, so
we fetch the article HTML and parse the "constituents" table directly.

Note: a handful of tickers use dot notation here (e.g. BRK.B, BF.B). Some
price vendors expect a dash instead (BRK-B) -- this isn't normalized here,
so double check formatting if backfill fails for those specific tickers.
"""
from typing import Dict, List

import requests
from bs4 import BeautifulSoup

WIKI_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
USER_AGENT = "adam-smiths-hot-tub-time-machine/0.1 (educational project)"


def fetch_constituents() -> List[Dict[str, str]]:
    resp = requests.get(WIKI_URL, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()

    soup = BeautifulSoup(resp.text, "html.parser")
    table = soup.find("table", {"id": "constituents"})
    if table is None:
        table = soup.find("table", {"class": "wikitable"})
    if table is None:
        raise RuntimeError("Could not find the constituents table on the Wikipedia page")

    body = table.find("tbody") or table
    rows = body.find_all("tr")

    records = []
    for tr in rows:
        cells = tr.find_all(["td", "th"])
        if len(cells) < 3:
            continue
        symbol = cells[0].get_text(strip=True)
        name = cells[1].get_text(strip=True)
        sector = cells[2].get_text(strip=True)
        if not symbol or symbol.lower() == "symbol":
            continue
        records.append({"ticker": symbol, "name": name, "sector": sector})

    return records


def sync_companies(db) -> Dict[str, int]:
    from .. import models

    records = fetch_constituents()
    existing = {c.ticker: c for c in db.query(models.Company).all()}

    created = 0
    updated = 0
    for rec in records:
        ticker = rec["ticker"]
        company = existing.get(ticker)
        if company is None:
            db.add(models.Company(ticker=ticker, name=rec["name"], sector=rec["sector"]))
            created += 1
        elif company.name != rec["name"] or company.sector != rec["sector"]:
            company.name = rec["name"]
            company.sector = rec["sector"]
            updated += 1

    db.commit()
    return {"created": created, "updated": updated, "unchanged": len(records) - created - updated, "total": len(records)}
