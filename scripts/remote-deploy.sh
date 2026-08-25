#!/usr/bin/env bash
#
# One-shot deploy: back up, build, start, and confirm the new version is
# healthy. This is what scripts/deploy.ps1 (run from a Windows workstation)
# and the "Deploy" GitHub Actions workflow both run on the server -- the same
# steps RUNBOOK.md's "Deploying" section walks through by hand, wrapped up so
# a script or a CI job can drive them unattended.
#
# Run it directly on the server, from the repository root, after the code
# checked out here is already what you want running:
#     ./scripts/remote-deploy.sh
#
# It does not fetch or change branches itself -- `git pull` (or the fetch +
# merge --ff-only that deploy.ps1 and the GitHub Actions workflow use) is a
# separate step before this one.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[$(date '+%Y-%m-%d %H:%M:%S')] === UEP deploy: $(git rev-parse --short HEAD) on $(git branch --show-current) ==="

if [ ! -f .env ]; then
    echo "ERROR: .env is missing. Run ./scripts/setup-env.sh first (see RUNBOOK.md)." >&2
    exit 1
fi

echo
echo "--- 1/3: Backup ---"
./scripts/backup.sh

echo
echo "--- 2/3: Build and start ---"
docker compose up -d --build

echo
echo "--- 3/3: Waiting for backend and frontend to report healthy ---"
for _ in $(seq 1 30); do
    if docker compose ps backend 2>/dev/null | grep -q 'healthy' \
        && docker compose ps frontend 2>/dev/null | grep -q 'healthy'; then
        echo "[$(date '+%H:%M:%S')] Both backend and frontend are healthy."
        echo
        docker compose ps
        echo
        echo "Deploy complete. Open the site and check one real screen -- a backend"
        echo "that starts is not the same as an application that works."
        exit 0
    fi
    sleep 5
done

echo
echo "ERROR: backend/frontend did not report healthy within 150 seconds." >&2
echo >&2
echo "docker compose ps:" >&2
docker compose ps >&2
echo >&2
echo "Recent backend log:" >&2
docker compose logs backend | tail -40 >&2
exit 1
