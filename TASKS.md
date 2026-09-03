# Plan

## Stack
- Backend: Python + FastAPI, SQLite via SQLAlchemy, Alembic (migrations)
- Ingestion: REST vendor historical backfill (backend, e.g. Alpha Vantage/Tiingo/FMP) - live ticks are not persisted
- Frontend: Next.js + TypeScript, TanStack Table, Recharts/lightweight-charts, Tailwind
- Realtime: Next.js custom server (`ws` lib) connects directly to Finnhub WS (API key stays server-side) and rebroadcasts ticks to browser clients (needs custom server, not default serverless API routes)
- Types: openapi-typescript generates TS types from FastAPI's OpenAPI schema (single source of truth = Pydantic models)
- AI: local WebGPU LLM (WebLLM) in-browser generates plain SQL text (no MCP/function-calling - one fixed action, small models are more reliable at plain text than structured tool-call JSON); backend just executes it read-only. See AI contract below.

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
6. AI endpoint: safe read-only SQL execution (`/ai/execute-sql`) - no NL understanding server-side
7. Publish OpenAPI schema for frontend type generation

## Agent B - Frontend
1. App scaffold (Next.js/TS/Tailwind)
2. Generate TS types from backend OpenAPI schema (openapi-typescript)
3. Custom Next.js server + WS route: connects directly to Finnhub (server-side API key), rebroadcasts ticks to browser clients
4. Company table: sort/filter/pagination
5. Price chart(s): zoom/pan, multi-company overlay
6. Live updates via relay WS subscription
7. Notes UI: add/view notes on dates/companies, chart annotations
8. AI chat UI: WebLLM generates SQL client-side -> POST to `/ai/execute-sql` -> on error, feed error back to model for 1-2 retries -> render table/chart (chart type picked by a client-side heuristic, not the model)

## API contract (v0, draft)
- `GET /companies` -> list of {ticker, name, sector}
- `GET /prices?ticker=&from=&to=` -> [{date, open, high, low, close, volume}]
- `GET /quotes/latest?tickers=` -> last persisted close per ticker (fallback/initial paint)
- `WS /api/ws/ticks` (Next.js, public) -> connects to Finnhub directly, rebroadcasts live ticks to browser
- `GET|POST|PUT|DELETE /notes` -> {id, ticker, date, text}
- `POST /ai/execute-sql` -> {sql} -> {columns, rows} | {error}. Read-only SQLite connection + text validation (single SELECT statement, row limit) - defense in depth, not just a text check.

## Notes
- SQLite file lives on backend only (system of record). IndexedDB, if used, is frontend cache only, not source of truth.
