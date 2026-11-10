# Nymbus Conversies — one command to run it all.
#
#   make dev        install what's missing, then run backend (:8010) and frontend (:3010)
#   make install    the Python venv and the frontend's node_modules
#   make backend    the API alone, reloading on change
#   make frontend   the Next dev server alone
#   make check      type-check, lint and the help/template gates
#   make oas        pull the AFAS OAS and rewrite backend/json_files/schemas/
#
# Versions: Node from `.node-version` (via fnm when it's installed), Python 3.14.

SHELL := /bin/bash
PYTHON ?= python3.14
BACKEND_PORT ?= 8010
FRONTEND_PORT ?= 3010

VENV := backend/.venv
NODE_ENV_SETUP := if command -v fnm >/dev/null 2>&1; then eval "$$(fnm env)" && fnm use --install-if-missing >/dev/null; fi

.PHONY: dev install backend frontend check oas

$(VENV)/.installed: backend/requirements.txt
	$(PYTHON) -m venv $(VENV)
	$(VENV)/bin/pip install -q -r backend/requirements.txt
	touch $@

frontend/node_modules/.installed: frontend/package-lock.json
	cd frontend && $(NODE_ENV_SETUP) && npm ci --no-audit --no-fund
	touch $@

install: $(VENV)/.installed frontend/node_modules/.installed

backend: $(VENV)/.installed
	cd backend && .venv/bin/uvicorn main:app --reload --port $(BACKEND_PORT)

frontend: frontend/node_modules/.installed
	cd frontend && $(NODE_ENV_SETUP) && BACKEND_URL=http://127.0.0.1:$(BACKEND_PORT) npx next dev -p $(FRONTEND_PORT)

# Both at once; Ctrl-C stops both.
dev: install
	@echo "Backend  http://localhost:$(BACKEND_PORT)/api/health"
	@echo "Frontend http://localhost:$(FRONTEND_PORT)"
	@trap 'kill 0' INT TERM EXIT; \
	$(MAKE) --no-print-directory backend & \
	$(MAKE) --no-print-directory frontend & \
	wait

check: install
	cd frontend && $(NODE_ENV_SETUP) && npx tsc --noEmit -p . && npx eslint src && npm run help:check && npm run templates:check
	$(VENV)/bin/python -m compileall -q backend

oas: $(VENV)/.installed
	cd backend && .venv/bin/python scripts/sync_oas.py
