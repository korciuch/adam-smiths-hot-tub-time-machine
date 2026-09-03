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

## Migrations

```bash
alembic revision --autogenerate -m "message"
alembic upgrade head
```
