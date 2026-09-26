#!/bin/sh
# Backend container entrypoint.
#
# Migrations run HERE, once, before the application starts -- not from inside
# the application. The difference matters: if a migration fails, the container
# stops with a readable error and the previous version keeps serving, instead of
# a half-migrated database going live. It also means schema changes happen once
# per deploy rather than on every worker start.
#
# `set -e` is what enforces that: any failure below aborts before uvicorn runs.
set -e

echo "[entrypoint] Applying database migrations..."
alembic upgrade head
echo "[entrypoint] Migrations applied."

# Seeding also runs here, once, for the same reason. Every worker process seeds
# again on start-up (app/main.py), and on a brand-new database several doing it
# at the same moment would race to insert the same roles and provinces. Once
# this has run they all find everything present and write nothing.
echo "[entrypoint] Seeding reference data..."
python -c "from app.core.bootstrap import init_db; init_db()"
echo "[entrypoint] Reference data present."

# Worker processes: WEB_CONCURRENCY, which uvicorn reads itself (set in
# docker-compose.yml). One process runs one request's Python at a time, so a
# single worker made every page wait behind whatever heavy request was ahead
# of it. Each worker costs memory, and the container's limit covers them all.
echo "[entrypoint] Starting API server with ${WEB_CONCURRENCY:-1} worker(s)..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 "$@"
