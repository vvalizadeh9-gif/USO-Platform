#!/bin/sh
# Frontend container entrypoint: choose HTTP or HTTPS, then start nginx.
#
# Switching UEP to HTTPS used to mean editing nginx.conf by hand -- commenting
# out one server block and uncommenting two others, in the right order, on the
# server. That is a change nobody makes at 4pm on a Friday, which is why the
# platform ran in plain HTTP with a complete, correct, commented-out TLS
# configuration sitting directly beneath it.
#
# It is now one environment variable. The important property is what happens
# when it is set and the certificate is not there: this script stops the
# container with a readable error, rather than falling back to HTTP. A silent
# downgrade is the worst outcome available here -- everyone believes the site
# is encrypted and nothing says otherwise.
#
# `set -e` enforces that: any failure below aborts before nginx runs.
set -e

SNIPPETS=/etc/nginx/snippets
TARGET=/etc/nginx/conf.d/default.conf
# Where the certificate lives inside the container. Overridable because
# certbot nests its files under live/<domain>/ while a certificate from an
# internal authority is usually dropped in flat.
CERT_DIR="${UEP_CERT_DIR:-/etc/nginx/certs}"
CERT="$CERT_DIR/fullchain.pem"
KEY="$CERT_DIR/privkey.pem"

if [ "${UEP_ENABLE_TLS}" = "true" ]; then
    missing=""
    [ -r "$CERT" ] || missing="$missing\n  - $CERT"
    [ -r "$KEY" ] || missing="$missing\n  - $KEY"
    if [ -n "$missing" ]; then
        echo "[entrypoint] UEP_ENABLE_TLS=true, but the certificate is not readable:" >&2
        # shellcheck disable=SC2059
        printf "$missing\n" >&2
        echo "" >&2
        echo "Mount the certificate directory into this container at" >&2
        echo "$CERT_DIR (docker-compose.yml has the line, commented), or set" >&2
        echo "UEP_CERT_DIR if the files live somewhere else inside it." >&2
        echo "TLS-SETUP.md covers both Let's Encrypt and an internal" >&2
        echo "certificate authority." >&2
        echo "" >&2
        echo "Refusing to start. Serving plain HTTP instead would leave every" >&2
        echo "password and session token readable on the network while the" >&2
        echo "deployment believed it was encrypted." >&2
        exit 1
    fi

    if [ -z "${UEP_SERVER_NAME}" ]; then
        echo "[entrypoint] UEP_ENABLE_TLS=true requires UEP_SERVER_NAME to be" >&2
        echo "set to the address the site is served from, for example" >&2
        echo "uep.example.com. Refusing to start." >&2
        exit 1
    fi

    echo "[entrypoint] TLS enabled for ${UEP_SERVER_NAME}."
    # sed, not envsubst: envsubst comes from gettext, which is not guaranteed
    # to be in a future base image, and it would need an explicit allow-list
    # anyway or it would eat nginx's own $host and $uri. One named placeholder
    # substituted by one tool that every image with a shell already has.
    sed -e "s|@@UEP_SERVER_NAME@@|${UEP_SERVER_NAME}|g" \
        -e "s|@@UEP_CERT_DIR@@|${CERT_DIR}|g" \
        "$SNIPPETS/tls.conf" > "$TARGET"
else
    echo "[entrypoint] Serving plain HTTP. Set UEP_ENABLE_TLS=true and mount a"
    echo "[entrypoint] certificate to switch; see TLS-SETUP.md."
    cp "$SNIPPETS/http.conf" "$TARGET"
fi

# Catch a broken configuration here, where the error is readable and the
# container simply fails to start, rather than after nginx has already dropped
# the old process.
nginx -t

# Hand over to the base image's own entrypoint when it is there, so the
# nginx-unprivileged setup steps in /docker-entrypoint.d still run -- worker
# tuning and local resolvers among them. Replacing it outright would drop
# those silently.
if [ -x /docker-entrypoint.sh ]; then
    exec /docker-entrypoint.sh "$@"
fi
exec "$@"
