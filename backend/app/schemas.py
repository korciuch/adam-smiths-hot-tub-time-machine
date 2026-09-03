import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class CompanyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ticker: str
    name: str
    sector: Optional[str] = None


class PriceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    date: datetime.date
    open: float
    high: float
    low: float
    close: float
    volume: int


class QuoteOut(BaseModel):
    ticker: str
    close: float
    date: datetime.date


class NoteBase(BaseModel):
    company_id: Optional[int] = None
    date: Optional[datetime.date] = None
    text: str = Field(min_length=1, max_length=2000)


class NoteCreate(NoteBase):
    pass


class NoteUpdate(BaseModel):
    company_id: Optional[int] = None
    date: Optional[datetime.date] = None
    text: Optional[str] = Field(default=None, min_length=1, max_length=2000)


class NoteOut(NoteBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime.datetime


class AIQueryRequest(BaseModel):
    question: str = Field(min_length=1)


class AIQueryResponse(BaseModel):
    answer: str
    data: Optional[List[Dict]] = None
    chart_spec: Optional[Dict] = None
