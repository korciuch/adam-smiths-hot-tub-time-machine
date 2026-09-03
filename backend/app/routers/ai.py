from fastapi import APIRouter
from sqlalchemy.exc import SQLAlchemyError

from .. import schemas
from ..readonly import run_select
from ..sql_guard import SqlNotAllowed, validate_select

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/execute-sql", response_model=schemas.SQLExecuteResponse)
def execute_sql(payload: schemas.SQLExecuteRequest):
    """Execute a read-only SELECT written by the client's in-browser model.

    There is no natural-language understanding here by design (TASKS.md): the
    WebLLM engine in the browser translates the question, and this endpoint is
    one fixed, guarded action. See `sql_guard` for the trust model.
    """
    try:
        sql = validate_select(payload.sql)
    except SqlNotAllowed as exc:
        return schemas.SQLExecuteResponse(error=str(exc))

    try:
        columns, rows, truncated = run_select(sql)
    except SQLAlchemyError as exc:
        # The driver's message ("no such column: ticker") is what makes the
        # client's retry pass work, so it is passed through rather than
        # flattened into a generic failure. `orig` strips SQLAlchemy's
        # wrapper text and the echoed statement.
        detail = str(getattr(exc, "orig", exc)) or exc.__class__.__name__
        if "interrupted" in detail:
            detail = "Query took too long. Add a filter or an aggregate to reduce the work."
        return schemas.SQLExecuteResponse(error=detail)

    # `truncated` is not an error: the rows are valid and the client renders
    # them under a notice. Setting `error` here would send a successful query
    # back into the retry loop.
    return schemas.SQLExecuteResponse(columns=columns, rows=rows, truncated=truncated)
