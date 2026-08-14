#!/usr/bin/env bash
#
# Back up the UEP database.
#
# Writes a compressed dump into backups/daily/, keeps 14 of them, and every
# Sunday also copies one into backups/weekly/, keeping 3 months' worth.
#
# Run it by hand:
#     ./scripts/backup.sh
#
# Run it automatically every night at 02:30 -- `crontab -e` on the server, then:
#     30 2 * * * cd /path/to/USO-Platform && ./scripts/backup.sh >> backups/backup.log 2>&1
#
# Full instructions, and how to restore, are in BACKUP-RUNBOOK.md.
#
# `set -euo pipefail` makes the script stop at the first problem instead of
# carrying on and reporting success. A backup script that lies is worse than no
# backup script.
set -euo pipefail

cd "$(dirname "$0")/.."

DAILY_DIR="backups/daily"
WEEKLY_DIR="backups/weekly"
DAILY_KEEP_DAYS=14
WEEKLY_KEEP_DAYS=93          # about three months
TIMESTAMP="$(date +%Y-%m-%d_%H%M)"

DB_USER="${POSTGRES_USER:-uep}"
DB_NAME="${POSTGRES_DB:-uep}"
if [ -f .env ]; then
    # Read POSTGRES_USER / POSTGRES_DB from .env without executing the file.
    DB_USER="$(grep -E '^POSTGRES_USER=' .env | tail -1 | cut -d= -f2- || echo "$DB_USER")"
    DB_NAME="$(grep -E '^POSTGRES_DB=' .env | tail -1 | cut -d= -f2- || echo "$DB_NAME")"
    DB_USER="${DB_USER:-uep}"
    DB_NAME="${DB_NAME:-uep}"
fi

TARGET="${DAILY_DIR}/uep-${TIMESTAMP}.dump"

mkdir -p "$DAILY_DIR" "$WEEKLY_DIR"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting backup of database '${DB_NAME}'..."

if ! docker compose ps --status running db 2>/dev/null | grep -q db; then
    echo "ERROR: the 'db' container is not running. Nothing was backed up." >&2
    exit 1
fi

# -Fc is PostgreSQL's own compressed format. It is what restore.sh expects, and
# unlike a plain .sql file it lets you restore selected tables if you ever need
# to. Written to a temporary name first so an interrupted run cannot leave a
# half-written file looking like a real backup.
docker compose exec -T db pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "${TARGET}.partial"
mv "${TARGET}.partial" "$TARGET"

SIZE_BYTES="$(stat -c%s "$TARGET" 2>/dev/null || stat -f%z "$TARGET")"

# A dump of a database that has any data in it is comfortably over 1 KB. Smaller
# than that means pg_dump produced nothing useful, which must not be reported as
# success -- that is exactly how people discover an empty backup two years later.
if [ "$SIZE_BYTES" -lt 1024 ]; then
    echo "ERROR: backup is only ${SIZE_BYTES} bytes, which cannot be right." >&2
    echo "       Keeping it as ${TARGET}.suspect for inspection." >&2
    mv "$TARGET" "${TARGET}.suspect"
    exit 1
fi

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Wrote ${TARGET} ($(numfmt --to=iec "$SIZE_BYTES" 2>/dev/null || echo "${SIZE_BYTES} bytes"))"

# Sundays also go to the weekly set, so there is still something to fall back on
# when a problem is noticed more than two weeks after it started.
if [ "$(date +%u)" -eq 7 ]; then
    cp "$TARGET" "${WEEKLY_DIR}/uep-${TIMESTAMP}.dump"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Also kept as a weekly backup."
fi

# Rotation. -mtime +N deletes files older than N days.
DELETED_DAILY="$(find "$DAILY_DIR" -name 'uep-*.dump' -mtime +${DAILY_KEEP_DAYS} -print -delete | wc -l)"
DELETED_WEEKLY="$(find "$WEEKLY_DIR" -name 'uep-*.dump' -mtime +${WEEKLY_KEEP_DAYS} -print -delete | wc -l)"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rotation: removed ${DELETED_DAILY} daily and ${DELETED_WEEKLY} weekly backup(s)."
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Now holding $(find "$DAILY_DIR" -name 'uep-*.dump' | wc -l) daily and $(find "$WEEKLY_DIR" -name 'uep-*.dump' | wc -l) weekly backup(s)."
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup complete."
echo
echo "Reminder: a backup nobody has ever restored is not a backup. If it has"
echo "been more than six months since the last restore drill, see BACKUP-RUNBOOK.md."
