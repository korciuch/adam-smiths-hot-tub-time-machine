# Frontend

Next.js 16 dashboard for the data in `../backend`. Node 24 (`.nvmrc`).

```bash
npm install
cp .env.example .env.local   # BACKEND_URL, optionally FINNHUB_API_KEY
npm run dev                  # http://localhost:3000
```

The backend doesn't have to be up; reads degrade to an inline message.

| Script | |
|---|---|
| `dev` | custom server + tick relay |
| `build` / `start` | production |
| `typecheck` / `lint` | `tsc --noEmit` / eslint |
| `gen:types` | regenerate API types from a running backend |
| `gen:types:offline` | same, from the committed `openapi.json` |

## Things you can't guess from the code

**Types are generated.** `src/lib/api/schema.d.ts` comes from the backend's
OpenAPI doc; don't hand-edit it, and rerun `gen:types` after backend schema
changes. `openapi.json` is a snapshot so builds don't need a live backend.

**`GET /prices` takes `from_`, not `from`** — Python keyword clash. `TASKS.md`
says `from`, so `Query(alias="from")` is expected on the backend; it will fail
typecheck in `src/lib/api/queries.ts`, which is intended.

**`chart_spec` is an untyped object in the API.** The shape this app accepts is
specified and validated in `src/lib/ai/chart-spec.ts`. Anything else is dropped
and the answer renders as a table.

**Reads are Server Components, writes are Server Actions** — so `BACKEND_URL`
stays server-side and there's no CORS config or client fetch library.

**`?tickers=AAPL,,GOOG` — the empty slot is deliberate.** Slot index is color
index; removing a company must not repaint the others.

**The relay is plain JS and can't import `src/lib/ticks/protocol.ts`.** Keep the
two in sync by hand. `scripts/relay-smoke-test.mjs --symbols BINANCE:BTCUSDT`
exercises every message shape; Finnhub's free tier only pushes on a real print,
so crypto is the only reliable signal outside market hours.

**No dual axis, ever.** Cross-company comparison uses "Index to 100".

**Light mode's aqua, yellow and magenta are under 3:1 on the surface,** so the
legend, direct labels and table views aren't optional decoration.
