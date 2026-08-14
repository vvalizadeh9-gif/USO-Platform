#!/usr/bin/env bash
#
# Create the .env file the server needs, with real secrets.
#
#     ./scripts/setup-env.sh
#
# Run this once, before the first deploy.
#
# The backend deliberately refuses to start on the example values shipped in
# .env.example -- they are published in this repository, so a server running on
# them can have admin tokens forged by anyone who reads it. That check is only
# useful if setting real values is easy, which is what this script is for. It
# generates the two secrets and the database password with `openssl rand`, and
# asks you for the one thing it cannot know: the address the site is served
# from.
#
# It will not overwrite an existing .env. To rotate a secret in an .env you
# already have, see RUNBOOK.md.
set -euo pipefail

cd "$(dirname "$0")/.."

TEMPLATE="backend/.env.example"
TARGET=".env"

if [ -f "$TARGET" ]; then
    cat <<EOF

  .env already exists.

  This script will not overwrite it -- doing so would change the database
  password out from under a database that is already using it, and lock the
  application out of its own data.

  To change one value, edit it directly:   nano .env
  To rotate the JWT secret safely:         see RUNBOOK.md

EOF
    exit 1
fi

if [ ! -f "$TEMPLATE" ]; then
    echo "ERROR: $TEMPLATE is missing. Run this from the repository root." >&2
    exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
    echo "ERROR: openssl is not installed, so secrets cannot be generated." >&2
    echo "       Install it (apt install openssl) and run this again." >&2
    exit 1
fi

echo
echo "  Setting up .env for UEP"
echo "  ======================="
echo

# --- The one thing that cannot be generated --------------------------------
cat <<EOF
  What address will people type into their browser to reach UEP?

  Include http:// or https://. Examples:
      http://uep.example.com
      https://uep.example.com
      http://192.168.1.50

  This becomes CORS_ORIGINS. Getting it wrong does not create a security hole
  -- the backend simply refuses requests from anywhere else, so the login page
  will fail to reach the API and you will know immediately.

EOF
read -r -p "  Address: " SITE_ORIGIN

if [ -z "$SITE_ORIGIN" ]; then
    echo "  Nothing entered. Cancelled; no .env was written." >&2
    exit 1
fi

case "$SITE_ORIGIN" in
    http://*|https://*) ;;
    *)
        echo
        echo "  That does not start with http:// or https://." >&2
        echo "  Cancelled; no .env was written. Run the script again." >&2
        exit 1
        ;;
esac

# Trailing slashes make the origin fail to match what the browser sends.
SITE_ORIGIN="${SITE_ORIGIN%/}"

# --- Generate the secrets --------------------------------------------------
# -hex so the values are safe to paste anywhere and contain no shell
# metacharacters. 32 bytes = 64 characters, comfortably past the 32-character
# minimum the backend enforces.
JWT_SECRET="$(openssl rand -hex 32)"
DB_PASSWORD="$(openssl rand -hex 16)"
ADMIN_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"

# --- Write it --------------------------------------------------------------
# Built from .env.example so any setting added there later is carried across
# with its documentation, rather than this script holding a second, drifting
# copy of the list.
umask 077   # so the file is created private, before any secret is in it
cp "$TEMPLATE" "$TARGET"

replace() {
    # Replace a KEY=... line wholesale. The value goes in via an argument
    # rather than being interpolated into the sed script, so characters in a
    # generated password can never be read as sed syntax.
    KEY="$1" VALUE="$2" python3 - "$TARGET" <<'PY'
import os, sys, pathlib
key, value = os.environ["KEY"], os.environ["VALUE"]
path = pathlib.Path(sys.argv[1])
out = []
replaced = False
for line in path.read_text().splitlines():
    if line.startswith(f"{key}=") and not line.lstrip().startswith("#"):
        out.append(f"{key}={value}")
        replaced = True
    else:
        out.append(line)
if not replaced:
    out.append(f"{key}={value}")
path.write_text("\n".join(out) + "\n")
PY
}

replace JWT_SECRET_KEY "$JWT_SECRET"
replace POSTGRES_PASSWORD "$DB_PASSWORD"
replace FIRST_ADMIN_PASSWORD "$ADMIN_PASSWORD"
replace CORS_ORIGINS "$SITE_ORIGIN"
# The connection string embeds the same password, so it has to move with it.
replace DATABASE_URL "postgresql+psycopg://uep:${DB_PASSWORD}@db:5432/uep"

chmod 600 "$TARGET"

cat <<EOF

  Written .env (readable only by you).

  ---------------------------------------------------------------
  WRITE THIS DOWN NOW. It is not shown again.

    Sign in at : $SITE_ORIGIN
    Username   : admin
    Password   : $ADMIN_PASSWORD
  ---------------------------------------------------------------

  Put that password in whatever your organisation uses to store passwords,
  then change it after your first sign-in via Admin -> Users -> Edit.

  The JWT signing key and the database password were generated too. You do not
  need to know them, but .env is now the only copy -- it is excluded from git
  on purpose, so it is not backed up with your code. If you lose it, the
  database password goes with it and the application cannot open its own data.
  Keep a copy somewhere safe.

  Next:
      docker compose up -d --build
      docker compose logs backend | head -40

EOF
