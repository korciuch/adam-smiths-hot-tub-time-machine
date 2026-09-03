from fastapi import APIRouter

from .. import schemas

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/query", response_model=schemas.AIQueryResponse)
def ai_query(payload: schemas.AIQueryRequest):
    # TODO: wire up LLM NL -> SQL translation. Stubbed so the response shape
    # is stable for frontend integration ahead of the real implementation.
    return schemas.AIQueryResponse(
        answer=f"AI query endpoint not yet implemented. You asked: {payload.question!r}",
        data=None,
        chart_spec=None,
    )
