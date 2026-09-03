"""A connection that cannot write, for executing client-supplied SELECTs.

Layers 2 and 3 of the guard described in `sql_guard`. Deliberately a separate
engine from the application's: these connections carry restrictions that must
never leak into a request that legitimately writes (notes CRUD, ingestion).
`NullPool` makes that structural - no connection is ever handed back to a
pool where the app might reuse it.
"""

import datetime
import decimal
import time
from typing import Any
from urllib.parse import quote

from sqlalchemy import create_engine, event
from sqlalchemy.pool import NullPool

from .database import DATABASE_URL

# A question about the S&P 500 that needs more than this wants a chart built
# from an aggregate, not 100k rows shipped through a browser.
MAX_ROWS = 1000

# Generous for an indexed query over daily bars, short enough that a cartesian
# join does not hold a connection open. A read-only connection is no defence
# against `FROM prices, prices, prices`.
TIMEOUT_SECONDS = 5.0

_IS_SQLITE = DATABASE_URL.startswith("sqlite")


def _readonly_url(url: str) -> str:
    """Rewrite a SQLite URL to open the file read-only.

    Enforced by the OS file handle rather than by SQL, so no statement can
    undo it. Non-SQLite URLs pass through - they rely on `query_only`.
    """
    prefix = "sqlite:///"
    if not url.startswith(prefix) or url.startswith(prefix + "file:"):
        return url
    path = url[len(prefix) :]
    if not path or path == ":memory:":
        return url
    return f"{prefix}file:{quote(path)}?mode=ro&uri=true"


readonly_engine = create_engine(
    _readonly_url(DATABASE_URL),
    poolclass=NullPool,
    connect_args={"check_same_thread": False} if _IS_SQLITE else {},
)


if _IS_SQLITE:

    @event.listens_for(readonly_engine, "connect")
    def _set_query_only(dbapi_connection: Any, _record: Any) -> None:
        cursor = dbapi_connection.cursor()
        try:
            cursor.execute("PRAGMA query_only = ON")
        finally:
            cursor.close()


def _jsonable(value: Any) -> Any:
    """Coerce a driver value into something Pydantic can emit as JSON."""
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, (datetime.date, datetime.datetime)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray)):
        return value.hex()
    return str(value)


def run_select(sql: str) -> tuple[list[str], list[dict[str, Any]], bool]:
    """Execute a pre-validated SELECT. Returns (columns, rows, truncated)."""
    with readonly_engine.connect() as connection:
        raw = getattr(connection.connection, "driver_connection", None)
        deadline = time.monotonic() + TIMEOUT_SECONDS
        # SQLite has no statement timeout; the progress handler is the only
        # way to interrupt a long query. Returning non-zero aborts it, which
        # surfaces as OperationalError('interrupted').
        can_interrupt = hasattr(raw, "set_progress_handler")
        if can_interrupt:
            raw.set_progress_handler(lambda: int(time.monotonic() > deadline), 10_000)

        try:
            # exec_driver_sql, not text(): text() treats `:name` as a bind
            # parameter, and a generated query containing a time literal like
            # '09:30' would fail on a placeholder the caller never wrote.
            result = connection.exec_driver_sql(sql)
            columns = list(result.keys())
            fetched = result.fetchmany(MAX_ROWS + 1)
        finally:
            if can_interrupt:
                raw.set_progress_handler(None, 0)

    truncated = len(fetched) > MAX_ROWS
    rows = [
        {key: _jsonable(value) for key, value in row._mapping.items()}
        for row in fetched[:MAX_ROWS]
    ]
    return columns, rows, truncated
