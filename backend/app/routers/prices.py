import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(tags=["prices"])


@router.get("/prices", response_model=list[schemas.PriceOut])
def get_prices(
    ticker: str,
    # `from` is a Python keyword, so the parameter is named `from_` and aliased
    # back to the name TASKS.md specifies.
    from_: Optional[datetime.date] = Query(default=None, alias="from"),
    to: Optional[datetime.date] = None,
    db: Session = Depends(get_db),
):
    company = db.scalar(select(models.Company).where(models.Company.ticker == ticker.upper()))
    if not company:
        raise HTTPException(status_code=404, detail="Unknown ticker")

    stmt = select(models.Price).where(models.Price.company_id == company.id)
    if from_:
        stmt = stmt.where(models.Price.date >= from_)
    if to:
        stmt = stmt.where(models.Price.date <= to)
    stmt = stmt.order_by(models.Price.date)

    return db.scalars(stmt).all()


@router.get("/quotes/latest", response_model=list[schemas.QuoteOut])
def latest_quotes(tickers: str, db: Session = Depends(get_db)):
    symbols = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    if not symbols:
        return []

    # Two queries regardless of how many tickers are asked for. The dashboard
    # requests the whole table at once, so the per-ticker loop this replaces ran
    # ~1000 queries for the full index.
    companies = db.scalars(
        select(models.Company).where(models.Company.ticker.in_(symbols))
    ).all()
    if not companies:
        return []

    ticker_by_id = {company.id: company.ticker for company in companies}

    latest_date = (
        select(
            models.Price.company_id.label("company_id"),
            func.max(models.Price.date).label("date"),
        )
        .where(models.Price.company_id.in_(ticker_by_id))
        .group_by(models.Price.company_id)
        .subquery()
    )
    rows = db.execute(
        select(models.Price.company_id, models.Price.close, models.Price.date).join(
            latest_date,
            (models.Price.company_id == latest_date.c.company_id)
            & (models.Price.date == latest_date.c.date),
        )
    ).all()

    close_by_id = {row.company_id: (row.close, row.date) for row in rows}

    # Ordered by the caller's list, not the database's, so the response lines up
    # with whatever the client asked for.
    results: list[schemas.QuoteOut] = []
    for company in sorted(companies, key=lambda c: symbols.index(c.ticker)):
        found = close_by_id.get(company.id)
        if found:
            results.append(
                schemas.QuoteOut(ticker=company.ticker, close=found[0], date=found[1])
            )

    return results
