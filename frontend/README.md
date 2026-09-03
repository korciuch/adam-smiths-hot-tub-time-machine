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
| `check:ai` | chart inference + SQL lint checks (no browser, no backend) |

## Things you can't guess from the code

**Types are generated.** `src/lib/api/schema.d.ts` comes from the backend's
OpenAPI doc; don't hand-edit it, and rerun `gen:types` after backend schema
changes. `openapi.json` is a snapshot so builds don't need a live backend.

**Query objects in `src/lib/api/queries.ts` are annotated, not inline.**
openapi-fetch's generics widen an inline literal enough that a stale or misspelled
parameter name passes typecheck and is then silently dropped by FastAPI. Assigning
to `PricesQuery`/`QuotesQuery`/`NotesQuery` first restores excess-property
checking. Learned the hard way on `from` vs `from_`.

**The AI panel runs a real LLM in the browser.** WebLLM loads a WebGPU model on
the first question (`src/lib/ai/engine.ts`, in a worker so generation doesn't
freeze the tab), translates the question to SQL, and posts only the SQL to
`/ai/execute-sql`. The question never reaches the server. Weights are cached in
IndexedDB after the first load; `NEXT_PUBLIC_WEBLLM_MODEL_ID` overrides the
default 3B model with something smaller on a constrained machine.

**The chart type is a client-side heuristic, not a model output**
(`src/lib/ai/infer-chart.ts`), then validated through `chart-spec.ts` like any
other spec. The models in `research/webgpu-models/MODEL_FINDINGS.md` could not
reliably keep a required column in the SELECT list, so they are not trusted with
a second artifact that references those columns. The non-obvious part is the
pivot: `(date, ticker, close)` has to become one series per ticker, or a
two-company comparison plots as one line zig-zagging between them.

**`lintSql` catches errors the database won't.** `company_id = 'AAPL'` — the
documented 1B failure — is valid SQLite that matches zero rows and returns no
error, so the correction loop can't see it. Silent wrong answers get caught
client-side before the round trip; anything the driver rejects is fed back to
the model instead, since its message is the better hint.

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
