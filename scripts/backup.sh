#!/usr/bin/env bash
#
# Back up UEP: the database, and the uploaded letters and attachments.
#
# Both go into backups/daily/, where the last 14 of each are kept. Every Sunday
# a copy also goes into backups/weekly/, where 3 months' worth are kept.
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

# --- Uploaded files -------------------------------------------------------
#
# pg_dump covers the database and nothing else. Letters and attachments live in
# a separate Docker volume, and a database restored without them leaves every
# letter link pointing at a file that is not there. They are backed up here so
# the nightly job covers the whole system rather than most of it.
#
# The volume is read through a throwaway container, because it belongs to Docker
# rather than to a path on the host. Its name is looked up rather than assumed:
# Compose prefixes volume names with the project directory, so the full name
# changes if that directory is ever renamed.
#
# A failure here warns but does not abort. A missing letter is bad; losing the
# database backup that already succeeded, because the uploads step failed after
# it, would be worse.
UPLOADS_TARGET="${DAILY_DIR}/uep-uploads-${TIMESTAMP}.tar.gz"
UPLOADS_VOLUME="$(docker volume ls --format '{{.Name}}' | grep -E '_uep_uploads$' | head -1 || true)"

if [ -z "$UPLOADS_VOLUME" ]; then
    echo "WARNING: could not find the uploads volume; letters and attachments" >&2
    echo "         were NOT backed up. The database backup above is fine." >&2
else
    if docker run --rm \
        -v "${UPLOADS_VOLUME}:/data:ro" \
        -v "$(pwd)/${DAILY_DIR}:/backup" \
        alpine tar czf "/backup/$(basename "$UPLOADS_TARGET")" -C /data . 2>/dev/null
    then
        UPLOADS_SIZE="$(stat -c%s "$UPLOADS_TARGET" 2>/dev/null || stat -f%z "$UPLOADS_TARGET")"
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Wrote ${UPLOADS_TARGET} ($(numfmt --to=iec "$UPLOADS_SIZE" 2>/dev/null || echo "${UPLOADS_SIZE} bytes")) from volume ${UPLOADS_VOLUME}"
    else
        echo "WARNING: backing up the uploads volume failed. The database backup" >&2
        echo "         above is fine, but letters and attachments were missed." >&2
    fi
fi

# Sundays also go to the weekly set, so there is still something to fall back on
# when a problem is noticed more than two weeks after it started.
if [ "$(date +%u)" -eq 7 ]; then
    cp "$TARGET" "${WEEKLY_DIR}/uep-${TIMESTAMP}.dump"
    # Absent when the uploads step above warned rather than succeeded.
    if [ -f "$UPLOADS_TARGET" ]; then
        cp "$UPLOADS_TARGET" "${WEEKLY_DIR}/"
    fi
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Also kept as a weekly backup."
fi

# Rotation. -mtime +N deletes files older than N days.
DELETED_DAILY="$(find "$DAILY_DIR" \( -name 'uep-*.dump' -o -name 'uep-uploads-*.tar.gz' \) -mtime +${DAILY_KEEP_DAYS} -print -delete | wc -l)"
DELETED_WEEKLY="$(find "$WEEKLY_DIR" \( -name 'uep-*.dump' -o -name 'uep-uploads-*.tar.gz' \) -mtime +${WEEKLY_KEEP_DAYS} -print -delete | wc -l)"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Rotation: removed ${DELETED_DAILY} daily and ${DELETED_WEEKLY} weekly backup(s)."
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Now holding $(find "$DAILY_DIR" -name 'uep-*.dump' | wc -l) daily and $(find "$WEEKLY_DIR" -name 'uep-*.dump' | wc -l) weekly database backup(s), plus $(find "$DAILY_DIR" "$WEEKLY_DIR" -name 'uep-uploads-*.tar.gz' | wc -l) uploads archive(s)."
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup complete."
echo
echo "Reminder: a backup nobody has ever restored is not a backup. If it has"
echo "been more than six months since the last restore drill, see BACKUP-RUNBOOK.md."
