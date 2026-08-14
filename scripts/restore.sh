#!/usr/bin/env bash
#
# Restore the UEP database from a backup file.
#
#     ./scripts/restore.sh backups/daily/uep-2026-08-14_0230.dump
#
# THIS REPLACES THE CURRENT DATABASE. Everything entered since that backup was
# taken is discarded. The script says exactly what it is about to do and makes
# you type the word "replace" before it does anything.
#
# Before restoring onto the live server, read the "Restoring for real" section
# of BACKUP-RUNBOOK.md. Practising a restore onto a scratch copy is covered
# there too, and is the only way to know your backups actually work.
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_FILE="${1:-}"

if [ -z "$BACKUP_FILE" ]; then
    echo "Usage: ./scripts/restore.sh <backup file>"
    echo
    echo "Available backups, newest first:"
    find backups -name 'uep-*.dump' -printf '%T@ %p\t%s bytes\n' 2>/dev/null \
        | sort -rn | cut -d' ' -f2- | head -20 \
        || echo "  (none found in backups/)"
    exit 1
fi

if [ ! -f "$BACKUP_FILE" ]; then
    echo "ERROR: no such file: $BACKUP_FILE" >&2
    exit 1
fi

DB_USER="${POSTGRES_USER:-uep}"
DB_NAME="${POSTGRES_DB:-uep}"
if [ -f .env ]; then
    DB_USER="$(grep -E '^POSTGRES_USER=' .env | tail -1 | cut -d= -f2- || echo "$DB_USER")"
    DB_NAME="$(grep -E '^POSTGRES_DB=' .env | tail -1 | cut -d= -f2- || echo "$DB_NAME")"
    DB_USER="${DB_USER:-uep}"
    DB_NAME="${DB_NAME:-uep}"
fi

if ! docker compose ps --status running db 2>/dev/null | grep -q db; then
    echo "ERROR: the 'db' container is not running. Start it with:" >&2
    echo "         docker compose up -d db" >&2
    exit 1
fi

BACKUP_DATE="$(date -r "$BACKUP_FILE" '+%A %-d %B %Y at %H:%M' 2>/dev/null || echo 'unknown date')"
SIZE="$(stat -c%s "$BACKUP_FILE" 2>/dev/null || stat -f%z "$BACKUP_FILE")"

cat <<EOF

  ABOUT TO REPLACE THE DATABASE
  =============================

  Restoring from : $BACKUP_FILE
  Taken          : $BACKUP_DATE
  Size           : $(numfmt --to=iec "$SIZE" 2>/dev/null || echo "$SIZE bytes")
  Into database  : $DB_NAME

  Everything currently in the database will be replaced by the contents of
  that file. Any work done since it was taken -- CPM imports, health checks,
  acceptances, new users -- will be gone.

EOF

read -r -p '  Type "replace" to continue, or anything else to cancel: ' CONFIRM
if [ "$CONFIRM" != "replace" ]; then
    echo "  Cancelled. Nothing was changed."
    exit 1
fi

echo
echo "[$(date '+%H:%M:%S')] Taking a safety copy of the CURRENT database first..."
mkdir -p backups/pre-restore
SAFETY="backups/pre-restore/uep-before-restore-$(date +%Y-%m-%d_%H%M).dump"
docker compose exec -T db pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$SAFETY"
echo "[$(date '+%H:%M:%S')] Safety copy: $SAFETY"
echo "           If this restore turns out to be a mistake, that file puts things back."

echo "[$(date '+%H:%M:%S')] Stopping the application so nothing writes during the restore..."
docker compose stop backend frontend >/dev/null 2>&1 || true

echo "[$(date '+%H:%M:%S')] Restoring..."
# --clean --if-exists drops each object before recreating it, so the restore
# does not fail on things that already exist. --no-owner ignores role ownership
# from the source database, which matters when restoring onto a scratch machine.
# pg_restore reports harmless notices on stderr, so its exit code is what counts.
set +e
docker compose exec -T db pg_restore -U "$DB_USER" -d "$DB_NAME" \
    --clean --if-exists --no-owner < "$BACKUP_FILE" 2> /tmp/uep-restore-errors.log
RESTORE_STATUS=$?
set -e

if [ $RESTORE_STATUS -ne 0 ]; then
    echo
    echo "  The restore reported problems. Details:" >&2
    tail -20 /tmp/uep-restore-errors.log >&2
    echo
    echo "  Some messages from pg_restore are harmless (it complains about" >&2
    echo "  dropping things that were not there). Check the application before" >&2
    echo "  assuming the worst. Your safety copy is at:" >&2
    echo "      $SAFETY" >&2
fi

# --- Uploaded files -------------------------------------------------------
#
# backup.sh writes an uploads archive alongside each database dump, named with
# the same timestamp. If the matching one is there, restore it too: a database
# restored without its letters leaves every letter link pointing at a file that
# is not on disk.
#
# Only restored when the matching archive exists. Restoring yesterday's letters
# next to last month's database would be worse than leaving them alone.
UPLOADS_ARCHIVE="$(dirname "$BACKUP_FILE")/$(basename "$BACKUP_FILE" .dump | sed 's/^uep-/uep-uploads-/').tar.gz"

if [ -f "$UPLOADS_ARCHIVE" ]; then
    UPLOADS_VOLUME="$(docker volume ls --format '{{.Name}}' | grep -E '_uep_uploads$' | head -1 || true)"
    if [ -n "$UPLOADS_VOLUME" ]; then
        echo "[$(date '+%H:%M:%S')] Restoring uploaded letters and attachments..."
        if docker run --rm \
            -v "${UPLOADS_VOLUME}:/data" \
            -v "$(cd "$(dirname "$UPLOADS_ARCHIVE")" && pwd):/backup:ro" \
            alpine sh -c "cd /data && tar xzf /backup/$(basename "$UPLOADS_ARCHIVE")"
        then
            echo "[$(date '+%H:%M:%S')] Uploads restored from $(basename "$UPLOADS_ARCHIVE")"
        else
            echo "WARNING: restoring the uploads archive failed. The database was" >&2
            echo "         restored; letters may be missing from disk." >&2
        fi
    else
        echo "WARNING: could not find the uploads volume; letters were not restored." >&2
    fi
else
    echo "[$(date '+%H:%M:%S')] No matching uploads archive; restoring the database only."
    echo "           (Expected: $(basename "$UPLOADS_ARCHIVE"))"
fi

echo "[$(date '+%H:%M:%S')] Starting the application again..."
docker compose up -d >/dev/null

echo "[$(date '+%H:%M:%S')] Waiting for the backend to report healthy..."
for _ in $(seq 1 30); do
    if docker compose ps backend 2>/dev/null | grep -q 'healthy'; then
        echo "[$(date '+%H:%M:%S')] Backend is healthy."
        break
    fi
    sleep 5
done

cat <<EOF

  RESTORE FINISHED

  Now check, in the application:
    1. Sign in.
    2. Open Acceptance and confirm the numbers look like that date.
    3. Open Admin -> Audit Log and confirm the most recent entry is from
       around when the backup was taken.

  If something is wrong, the database as it was before this restore is at:
      $SAFETY
  Restore that file the same way to undo.

EOF
