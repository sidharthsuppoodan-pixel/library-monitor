#!/bin/sh
set -eu
alembic upgrade head
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1 --limit-concurrency 100 --timeout-keep-alive 5 --no-access-log --no-proxy-headers
