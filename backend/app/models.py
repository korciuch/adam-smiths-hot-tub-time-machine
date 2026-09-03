import datetime
from typing import List, Optional

from sqlalchemy import Date, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


class Company(Base):
    __tablename__ = "companies"

    id: Mapped[int] = mapped_column(primary_key=True)
    ticker: Mapped[str] = mapped_column(String(10), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    sector: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)

    prices: Mapped[List["Price"]] = relationship(back_populates="company", cascade="all, delete-orphan")
    notes: Mapped[List["Note"]] = relationship(back_populates="company")


class Price(Base):
    __tablename__ = "prices"
    __table_args__ = (UniqueConstraint("company_id", "date", name="uq_price_company_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int] = mapped_column(ForeignKey("companies.id"), index=True)
    date: Mapped[datetime.date] = mapped_column(Date, index=True)
    open: Mapped[float]
    high: Mapped[float]
    low: Mapped[float]
    close: Mapped[float]
    volume: Mapped[int]

    company: Mapped["Company"] = relationship(back_populates="prices")


class Note(Base):
    __tablename__ = "notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[Optional[int]] = mapped_column(ForeignKey("companies.id"), nullable=True, index=True)
    date: Mapped[Optional[datetime.date]] = mapped_column(Date, nullable=True, index=True)
    text: Mapped[str] = mapped_column(String(2000))
    created_at: Mapped[datetime.datetime] = mapped_column(DateTime, default=datetime.datetime.utcnow)

    company: Mapped[Optional["Company"]] = relationship(back_populates="notes")
