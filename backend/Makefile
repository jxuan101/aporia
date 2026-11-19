PYTHON ?= $(if $(wildcard .venv/bin/python),.venv/bin/python,python3)
API_HOST ?= 0.0.0.0
API_PORT ?= 3000

.PHONY: help install install-dev api worker migrate test integration-test lint format-check

help: ## Show available backend commands
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_-]+:.*##/ {printf "  make %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

install: ## Install backend runtime dependencies
	$(PYTHON) -m pip install -e .

install-dev: ## Install backend and test/lint dependencies
	$(PYTHON) -m pip install -e '.[test]'

api: ## Run the FastAPI development server
	$(PYTHON) -m uvicorn app.main:app --reload --host $(API_HOST) --port $(API_PORT)

worker: ## Run the PostgreSQL-backed processing worker
	$(PYTHON) -m app.worker

migrate: ## Apply pending database migrations
	$(PYTHON) -m app.migrate

test: ## Run tests that do not require a database
	$(PYTHON) -m pytest -q

integration-test: ## Run all tests with BRAINDUMP_TEST_DATABASE_URL set
	@test -n "$$BRAINDUMP_TEST_DATABASE_URL" || (echo 'Set BRAINDUMP_TEST_DATABASE_URL to a dedicated *_test database.' >&2; exit 1)
	$(PYTHON) -m pytest -q

lint: ## Check backend Python lint rules
	$(PYTHON) -m ruff check app tests

format-check: ## Check Python formatting without changing files
	$(PYTHON) -m ruff format --check app tests
