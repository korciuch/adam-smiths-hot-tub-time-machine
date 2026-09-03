# S&P 500 tracker

A dashboard for S&P 500 constituents: historical prices, live trade ticks,
per-company notes, and natural-language questions answered by a language model
that runs **in your browser** over WebGPU — the backend only executes the SQL it
produces, behind a read-only allowlist.

- `backend/` — FastAPI + SQLAlchemy + Alembic over SQLite ([README](backend/README.md))
- `frontend/` — Next.js App Router, custom Node server for the tick relay ([README](frontend/README.md))
- `research/` — WebGPU/WebLLM spikes and their findings
- `scripts/` — standalone experiments, not part of the app

## Quick start

```bash
make up
```

That installs the Python and Node dependencies, migrates the database, loads
data, and starts both servers:

- frontend http://localhost:3000
- backend http://localhost:8000 (docs at `/docs`)

Ctrl-C stops both. Re-running `make up` is cheap — dependencies reinstall only
when `requirements.txt` or `package-lock.json` change, and the data load skips
rows that already exist.

### Requirements

Python ≥ 3.9, Node ≥ 24 (see `frontend/.nvmrc`), and `lsof`/`curl`, which macOS
and most Linux distributions already have. `make doctor` prints what you have
and what is holding the dev ports.

The AI query panel additionally needs **WebGPU** — Chrome 113+, Edge 113+ or
Safari 18+ — and downloads a couple of GB of model weights the first time you
ask a question. The browser caches them afterwards, so only that first question
is slow. Nothing else here needs WebGPU.

### Ports

Both are overridable, which is how you run this alongside another checkout:

```bash
make up BACKEND_PORT=8015 FRONTEND_PORT=3015
```

If a port is already taken, `make up` stops and says which PID holds it rather
than killing it — that process might not be this app. `make stop` frees both
ports when you do want them gone.

`BACKEND_PORT` is written into `frontend/.env.local` on first setup. That file
is never overwritten afterwards, so if you later switch ports, update
`BACKEND_URL` there too (`make up` warns when the two disagree).

## Targets

| | |
|---|---|
| `make up` | everything: install, migrate, load data, run |
| `make setup` | install backend and frontend dependencies |
| `make db` | migrate, then load data |
| `make migrate` | apply Alembic migrations only |
| `make data` | load price data only |
| `make reset-db` | delete the database and rebuild it from scratch |
| `make run` | run both servers (assumes `setup` and `db` are done) |
| `make stop` | kill whatever is listening on the dev ports |
| `make check` | lint, typecheck, and the verification scripts (needs data, so implies `db`) |
| `make doctor` | versions, database size, port occupancy |
| `make clean` | remove the venv, `node_modules`, `.next` and the database |

`make` on its own lists the same thing.

## Data

No credentials are needed. The prices are committed to the repo under `data/`,
and `make db` loads them: 503 companies and about 1.4M daily bars, which takes
a minute or so the first time and is a no-op afterwards. To load a subset, call
the loader directly (`--tickers`, `--years`; see
[backend/README.md](backend/README.md)). Refreshing the prices from the vendor
API is a separate, optional path that wants a `TWELVE_DATA_API_KEY` in
`backend/.env`.

Live ticks need a free `FINNHUB_API_KEY` in `frontend/.env.local`. Without one
the app runs fine and the tick indicator reports `unconfigured`.

The database is a single file, `backend/data.db`, ignored by git. Set
`DATABASE_URL` to move it — the app, Alembic and the loaders all read it — but
note that `make clean` and `make reset-db` still delete the default path.

## Working on it

Each side can be run on its own; see the two READMEs for the direct `uvicorn`
and `npm run dev` invocations, migrations, and API type generation. The
Makefile is a wrapper over exactly those commands, not a replacement for them.
