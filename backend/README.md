# Backend

FastAPI + SQLite (SQLAlchemy + Alembic).

## Setup

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
python seed.py   # optional sample data
```

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

- API: http://localhost:8000
- OpenAPI schema (for frontend type-gen): http://localhost:8000/openapi.json

## AI queries

There is no LLM here. The browser's WebLLM model writes the SQL; this service
only executes it, via `POST /ai/execute-sql` -> `{columns, rows, truncated, error}`.

That endpoint takes SQL from an untrusted client — the browser is not a trust
boundary and anything can POST to it directly — so it is guarded in three
independent layers: a sqlglot parse that admits only a single SELECT over
`companies`/`prices`/`notes` (`app/sql_guard.py`), a connection opened `mode=ro`
with `PRAGMA query_only` (`app/readonly.py`), and a 1000-row cap plus a 5s
interrupt. A rejected or failing query is a 200 with `error` set, not a 4xx: the
client feeds that message back to the model for a correction pass, so it is
ordinary control flow.

Verify all three layers, including the writes the read-only connection must
refuse even if the parser is assumed bypassed:

```bash
python scripts/check_sql_guard.py
```

## Migrations

```bash
alembic revision --autogenerate -m "message"
alembic upgrade head
```
