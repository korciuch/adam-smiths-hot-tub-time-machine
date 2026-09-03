# Plan

## Stack
- Backend: Python + FastAPI, SQLite via SQLAlchemy, Alembic (migrations)
- Ingestion: REST vendor historical backfill (backend, e.g. Alpha Vantage/Tiingo/FMP) - live ticks are not persisted
- Frontend: Next.js + TypeScript, TanStack Table, Recharts/lightweight-charts, Tailwind
- Realtime: Next.js custom server (`ws` lib) connects directly to Finnhub WS (API key stays server-side) and rebroadcasts ticks to browser clients (needs custom server, not default serverless API routes)
- Types: openapi-typescript generates TS types from FastAPI's OpenAPI schema (single source of truth = Pydantic models)
- AI: LLM call server-side (NL -> SQL/chart spec), rendered client-side

## Phase 0 (joint, do first)
- Freeze API contract (endpoints/schemas below) so both agents can build in parallel
- Backend stands up route stubs (Pydantic models, no real logic) so OpenAPI schema exists immediately
- Frontend wires up type generation against that schema

## Agent A - Backend
1. SQLAlchemy models + Alembic init: `companies`, `prices`, `notes`
2. S&P 500 constituent list ingestion (Wikipedia scrape or vendor endpoint)
3. Historical price backfill (Alpha Vantage/Tiingo/FMP)
4. REST API: companies, price history (filterable), last persisted close per ticker
5. Notes CRUD API
6. AI endpoint: NL query -> SQL -> structured data/chart spec
7. Publish OpenAPI schema for frontend type generation

## Agent B - Frontend
1. App scaffold (Next.js/TS/Tailwind)
2. Generate TS types from backend OpenAPI schema (openapi-typescript)
3. Custom Next.js server + WS route: connects directly to Finnhub (server-side API key), rebroadcasts ticks to browser clients
4. Company table: sort/filter/pagination
5. Price chart(s): zoom/pan, multi-company overlay
6. Live updates via relay WS subscription
7. Notes UI: add/view notes on dates/companies, chart annotations
8. AI chat UI: input -> render returned table/chart

## API contract (v0, draft)
- `GET /companies` -> list of {ticker, name, sector}
- `GET /prices?ticker=&from=&to=` -> [{date, open, high, low, close, volume}]
- `GET /quotes/latest?tickers=` -> last persisted close per ticker (fallback/initial paint)
- `WS /api/ws/ticks` (Next.js, public) -> connects to Finnhub directly, rebroadcasts live ticks to browser
- `GET|POST|PUT|DELETE /notes` -> {id, ticker, date, text}
- `POST /ai/query` -> {question} -> {data, chart_spec}

## Dev ports & DB isolation
- Backend dev: port 8000, DB `backend/data.db` (real ingested data). Frontend dev: port 3000 (Next.js custom server). Fixed, non-overlapping by convention - don't change defaults.
- Ephemeral/one-off test servers: backend 8001, frontend 3001. Always pair with an isolated DB (e.g. `DATABASE_URL=sqlite:///./test.db`), never the dev DB.
- Before starting any dev/test server: `lsof -ti:<port> | xargs kill -9` to guarantee a clean bind. Background processes can outlive a single terminal session and silently keep a port bound, causing a *new* server start to fail invisibly while a stale one keeps answering requests.
- After stopping a server: verify with `lsof -i :<port>` that nothing remains before trusting the next run.
- Never delete/recreate a DB file a server already has open and expect it to notice - a running process keeps its own file handle even after the file is unlinked and a new one is created with the same name. Stop the server first, reset the DB, then restart.

## Notes
- SQLite file lives on backend only (system of record). IndexedDB, if used, is frontend cache only, not source of truth.
