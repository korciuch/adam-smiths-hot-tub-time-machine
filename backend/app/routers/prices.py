import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db

router = APIRouter(tags=["prices"])


@router.get("/prices", response_model=list[schemas.PriceOut])
def get_prices(
    ticker: str,
    from_: Optional[datetime.date] = None,
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
    results: list[schemas.QuoteOut] = []

    for symbol in symbols:
        company = db.scalar(select(models.Company).where(models.Company.ticker == symbol))
        if not company:
            continue
        latest = db.scalar(
            select(models.Price)
            .where(models.Price.company_id == company.id)
            .order_by(models.Price.date.desc())
        )
        if latest:
            results.append(schemas.QuoteOut(ticker=symbol, close=latest.close, date=latest.date))

    return results
