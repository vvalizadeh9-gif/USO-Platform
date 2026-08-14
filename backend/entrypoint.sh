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

echo "[entrypoint] Starting API server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 "$@"
