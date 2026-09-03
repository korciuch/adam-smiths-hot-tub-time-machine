# One-command local deploy.
#
#   make up      install everything, prepare the database, run both servers
#   make help    list every target
#
# Written for GNU Make 3.81, which is what macOS ships: no `.ONESHELL`, so each
# recipe line is its own shell and anything needing shared state (a background
# PID, a trap) is one continued line.
#
# Ports default to the ones the two READMEs use, and are fixed rather than
# auto-selected: the frontend records BACKEND_URL in .env.local, so a port that
# moved on its own would leave the UI pointing at nothing. Override explicitly
# to run beside another checkout:
#
#   make up BACKEND_PORT=8015 FRONTEND_PORT=3015

BACKEND_PORT ?= 8000
FRONTEND_PORT ?= 3000
PYTHON ?= python3

VENV := $(CURDIR)/backend/.venv
VPY := $(VENV)/bin/python
VPIP := $(VENV)/bin/pip
# Matches app/database.py's default, which is absolute and so independent of the
# directory a command runs from. Setting DATABASE_URL overrides the app, Alembic
# and the loaders together (alembic/env.py reads the same variable) - but `clean`
# and `reset-db` still delete this path, so point them yourself if you move it.
DB_FILE := $(CURDIR)/backend/data.db
NODE_STAMP := $(CURDIR)/frontend/node_modules/.make-install-stamp
DEPS_STAMP := $(VENV)/.make-deps-stamp

.DEFAULT_GOAL := help
# migrate must finish before data loads; nothing here benefits from -j anyway.
.NOTPARALLEL:
.PHONY: help up setup db migrate data run stop reset-db check clean doctor

# Refuses instead of killing. Whatever holds the port may not be this app - a
# `kill -9` on a stranger's process is not a reasonable thing to do by default -
# and on a shared dev box it is often a colleague's server. `make stop` is the
# opt-in.
define require_port_free
@if lsof -ti:$(1) >/dev/null 2>&1; then \
  echo "error: port $(1) is in use by PID $$(echo $$(lsof -ti:$(1)))"; \
  echo "       free it with 'make stop', or pick other ports:"; \
  echo "       make up BACKEND_PORT=8015 FRONTEND_PORT=3015"; \
  exit 1; \
fi
endef

help: ## List targets
	@echo "S&P 500 tracker - local deploy"
	@echo ""
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-10s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "  backend  http://localhost:$(BACKEND_PORT)   frontend  http://localhost:$(FRONTEND_PORT)"

up: setup db run ## Install deps, prepare the database, run both servers

## ---------------------------------------------------------------- dependencies

setup: $(DEPS_STAMP) $(NODE_STAMP) frontend/.env.local ## Install backend and frontend dependencies

$(DEPS_STAMP): backend/requirements.txt
	@$(PYTHON) -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' \
	  || { echo "error: python3 >= 3.9 required, found $$($(PYTHON) --version 2>&1)"; exit 1; }
	@test -x $(VPY) || $(PYTHON) -m venv $(VENV)
	@echo "installing backend dependencies"
	@$(VPIP) install --quiet --upgrade pip
	@$(VPIP) install --quiet -r backend/requirements.txt
	@touch $@

# npm ci wipes node_modules, so the stamp lives inside it and is written after.
$(NODE_STAMP): frontend/package-lock.json frontend/package.json
	@node -e 'if (+process.versions.node.split(".")[0] < 24) { console.error("error: node >= 24 required, found " + process.version + " (see frontend/.nvmrc)"); process.exit(1) }'
	@echo "installing frontend dependencies"
	@cd frontend && npm ci --no-fund --no-audit
	@touch $@

# Not overwritten if it exists - it may hold a real FINNHUB_API_KEY.
frontend/.env.local:
	@sed 's|^BACKEND_URL=.*|BACKEND_URL=http://localhost:$(BACKEND_PORT)|' \
	  frontend/.env.example > $@
	@echo "wrote frontend/.env.local (BACKEND_URL -> :$(BACKEND_PORT))"

## --------------------------------------------------------------------- database

db: setup migrate data ## Create/upgrade the schema and load data

migrate: ## Apply Alembic migrations
	@echo "applying migrations"
	@cd backend && $(VENV)/bin/alembic upgrade head

# Prefers a committed CSV dataset when the checkout has one (no API key, no
# network) and falls back to synthetic bars when it does not, so this target
# needs no edit once the dataset lands. Both loaders are re-runnable: seed.py
# no-ops when rows already exist.
data: ## Load price data (committed dataset if present, else sample rows)
	@if [ -f backend/scripts/load_dataset.py ]; then \
	  echo "loading the committed dataset from data/"; \
	  cd backend && $(VPY) scripts/load_dataset.py; \
	else \
	  echo "note: no committed dataset in this checkout - seeding synthetic bars for 3 companies."; \
	  echo "      real prices need either the dataset (PR #8) or a TWELVE_DATA_API_KEY backfill."; \
	  cd backend && $(VPY) seed.py; \
	fi

# The port check is the point: deleting a SQLite file out from under a running
# server leaves it writing happily to an unlinked inode, so the API keeps
# answering from data that no longer exists on disk.
reset-db: ## Delete the database and rebuild it
	$(call require_port_free,$(BACKEND_PORT))
	@rm -f $(DB_FILE)
	@$(MAKE) --no-print-directory db

## ------------------------------------------------------------------------- run

# Backend in the background, frontend in the foreground, one trap so Ctrl-C on
# the frontend does not orphan the backend holding port $(BACKEND_PORT).
run: ## Run both servers (Ctrl-C stops both)
	$(call require_port_free,$(BACKEND_PORT))
	$(call require_port_free,$(FRONTEND_PORT))
	@grep -q "^BACKEND_URL=http://localhost:$(BACKEND_PORT)$$" frontend/.env.local \
	  || echo "warning: frontend/.env.local does not point BACKEND_URL at :$(BACKEND_PORT) - the UI will not reach the API"
	@echo "backend  -> http://localhost:$(BACKEND_PORT)"
	@echo "frontend -> http://localhost:$(FRONTEND_PORT)"
	@$(VENV)/bin/uvicorn --app-dir backend app.main:app --port $(BACKEND_PORT) & \
	  BACKEND_PID=$$!; \
	  trap 'kill $$BACKEND_PID 2>/dev/null' EXIT INT TERM; \
	  for _ in $$(seq 1 60); do \
	    curl -sf http://localhost:$(BACKEND_PORT)/health >/dev/null && break; \
	    sleep 0.5; \
	  done; \
	  curl -sf http://localhost:$(BACKEND_PORT)/health >/dev/null \
	    || { echo "error: backend did not come up on $(BACKEND_PORT)"; exit 1; }; \
	  cd frontend && PORT=$(FRONTEND_PORT) npm run dev

# For the usual case: a previous run's server outlived its terminal and still
# holds the port. Prints what it signals, because this will happily terminate an
# unrelated process that happens to be listening there.
stop: ## Free the dev ports (kills whatever is listening on them)
	@for port in $(BACKEND_PORT) $(FRONTEND_PORT); do \
	  pids=$$(lsof -ti:$$port); \
	  if [ -n "$$pids" ]; then \
	    echo "stopping port $$port (PID $$(echo $$pids))"; \
	    kill $$pids 2>/dev/null || true; \
	  fi; \
	done

## ----------------------------------------------------------------- diagnostics

# Depends on `db` because the SQL-guard checks assert on a row cap and a query
# timeout: against a near-empty database every query is instant and under the
# cap, so they report failures that say nothing about the code.
#
# The per-script `-f` tests keep this target usable on any branch, including ones
# where a given check has not landed yet.
check: setup db ## Run lint, typecheck and the verification scripts
	@cd frontend && npm run lint && npm run typecheck
	@if [ -f frontend/scripts/check-ai-client.ts ]; then cd frontend && npm run check:ai; fi
	@if [ -f backend/scripts/check_sql_guard.py ]; then cd backend && $(VPY) scripts/check_sql_guard.py; fi

doctor: ## Print versions and what is holding the dev ports
	@echo "make      $$(make --version | head -1)"
	@echo "python3   $$($(PYTHON) --version 2>&1)"
	@echo "node      $$(node --version)  (frontend/.nvmrc wants $$(cat frontend/.nvmrc))"
	@echo "venv      $$(test -x $(VPY) && $(VPY) --version 2>&1 || echo 'not created')"
	@echo "database  $$(test -f $(DB_FILE) && du -h $(DB_FILE) | awk '{print $$1}' || echo 'not created')"
	@echo "port $(BACKEND_PORT)  $$(lsof -ti:$(BACKEND_PORT) | tr '\n' ' ' | grep . || echo free)"
	@echo "port $(FRONTEND_PORT)  $$(lsof -ti:$(FRONTEND_PORT) | tr '\n' ' ' | grep . || echo free)"

# Leaves frontend/.env.local alone - it is the one file here that can hold
# something you cannot regenerate, namely a real FINNHUB_API_KEY.
clean: ## Remove venv, node_modules, build output and the database
	$(call require_port_free,$(BACKEND_PORT))
	$(call require_port_free,$(FRONTEND_PORT))
	@rm -rf $(VENV) frontend/node_modules frontend/.next $(DB_FILE)
	@echo "removed venv, node_modules, .next and $(DB_FILE)"
