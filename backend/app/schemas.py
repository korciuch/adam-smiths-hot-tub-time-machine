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


class SQLExecuteRequest(BaseModel):
    # No length ceiling beyond this: the client's model has a small context
    # window, so anything longer than a few KB is not a query it produced.
    sql: str = Field(min_length=1, max_length=8000)


class SQLExecuteResponse(BaseModel):
    """Result of a client-supplied SELECT.

    A rejected or failing query is a 200 with `error` set, not a 4xx. The
    client's retry loop feeds `error` back to the model for a correction pass,
    which makes a failed query ordinary control flow rather than an exception -
    and keeps the message out of a transport-level error envelope the browser
    would have to unwrap.
    """

    columns: List[str] = []
    rows: List[Dict] = []
    truncated: bool = False
    error: Optional[str] = None
