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

# 1. Can UEP use the database at all? (UEP-23)
#
# One plain-English line per check, each starting with [preflight], so the
# first lines of the backend log say what is wrong and what to ask IT for. On
# the Kubernetes cluster the log is the only place this can be read without a
# live connection into the pod. A failure stops the container here; Kubernetes
# restarts it and the same lines appear at the top of the next attempt's log.
python -m app.scripts.db_preflight --startup

# 2. Migrations, then seeding, under a PostgreSQL advisory lock (UEP-23).
#
# Two backend pods may start together; the lock makes the second wait until
# the first has finished, then find nothing to do. Seeding runs here, once,
# for the same reason it always did: every worker process seeds again on
# start-up (app/main.py), and on a brand-new database several doing it at the
# same moment would race to insert the same roles and provinces.
echo "[entrypoint] Applying database migrations and reference data..."
python -m app.scripts.migrate_with_lock
echo "[entrypoint] Migrations applied."

# Worker processes: WEB_CONCURRENCY, which uvicorn reads itself (set in
# docker-compose.yml, and in the uep-config ConfigMap on Kubernetes). One
# process runs one request's Python at a time, so a single worker made every
# page wait behind whatever heavy request was ahead of it. Each worker costs
# memory, and the container's limit covers them all.
echo "[entrypoint] Starting API server with ${WEB_CONCURRENCY:-1} worker(s)..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 "$@"
