# Turning on HTTPS

**Who this is for:** the person running the UEP server. No programming knowledge
assumed.

Right now UEP is served over plain HTTP. That means everything travelling
between a user's browser and the server — **including their password and their
session token** — goes across the network as readable text. Anyone able to watch
that network can read it and can sign in as that person afterwards.

This document explains how to fix that. Nothing here has been applied: the
configuration is written and sitting in `frontend/nginx.conf`, commented out,
waiting for a certificate.

---

## First, answer one question

**Can someone on the public internet reach this server by typing a domain name?**

| Answer | Go to |
|---|---|
| Yes — e.g. `uep.example.com` resolves publicly and port 80 is reachable | [Route A: Let's Encrypt](#route-a-lets-encrypt-free-automatic-renewal) |
| No — it is inside the private cloud / company network only | [Route B: an internal certificate](#route-b-a-certificate-from-your-own-organisation) |
| Not sure | See [How to check](#how-to-check-which-route-applies) |

You told me this was not decided yet, so both routes are written out in full.
They produce the same result; they differ only in who vouches for the
certificate and how much of the renewal is automatic.

### How to check which route applies

From a computer **outside** the company network (a phone on mobile data is the
easiest test), open a browser and go to `http://<the server address>`. If the
UEP login page appears, the server is publicly reachable — Route A. If it times
out, it is internal — Route B.

---

## Route A: Let's Encrypt (free, automatic renewal)

Let's Encrypt is a certificate authority trusted by every browser out of the
box. Certificates are free, last 90 days, and renew automatically.

**You need:** a domain name pointing at the server's public IP, and port 80
reachable from the internet (that is how Let's Encrypt verifies you control the
domain).

### 1. Add certbot to the deployment

Add this service to `docker-compose.yml`:

```yaml
  certbot:
    image: certbot/certbot:latest
    volumes:
      - certbot_certs:/etc/letsencrypt
      - certbot_webroot:/var/www/certbot
    # Wake up twice a day, renew anything within 30 days of expiry.
    entrypoint: /bin/sh -c 'trap exit TERM; while :; do certbot renew --quiet; sleep 12h & wait $${!}; done'
    restart: unless-stopped
```

And add these volumes to the `volumes:` section at the bottom:

```yaml
  certbot_certs:
  certbot_webroot:
```

And give the frontend access to them — in the `frontend` service:

```yaml
    volumes:
      - certbot_certs:/etc/nginx/certs:ro
      - certbot_webroot:/var/www/certbot
```

And publish the HTTPS port — uncomment this line under `frontend`:

```yaml
      - "443:8443"
```

> **A note on ports.** The frontend container runs as an unprivileged user, so
> inside the container nginx listens on **8080** and **8443**, not 80 and 443.
> `docker-compose.yml` maps the host's real 80 and 443 onto those. You never
> type the internal numbers into a browser; they only appear in `nginx.conf`
> and `docker-compose.yml`.

### 2. Let the verification through

In `frontend/nginx.conf`, uncomment **only** the redirect server block, and
inside it keep the `/.well-known/acme-challenge/` location. Leave the HTTPS
block commented for now — there is no certificate yet, and nginx refuses to
start if it is told to load one that does not exist.

Change `uep.example.com` to your real domain. Then:

```bash
docker compose up -d --build
docker compose exec frontend nginx -t
```

### 3. Request the certificate

Replace the domain and email with yours. The email is where expiry warnings go,
so use one that is actually read:

```bash
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d uep.example.com \
  --email you@example.com \
  --agree-tos --no-eff-email
```

Success looks like `Successfully received certificate.` and a path ending in
`/etc/letsencrypt/live/uep.example.com/fullchain.pem`.

If it fails, the usual cause is that port 80 is not reachable from the internet.
Nothing has changed — fix the firewall and run it again.

### 4. Turn HTTPS on

In `frontend/nginx.conf`:

- Comment out the plain-HTTP server block at the top.
- Uncomment the HTTPS block.
- Set the certificate paths to:

  ```nginx
  ssl_certificate     /etc/nginx/certs/live/uep.example.com/fullchain.pem;
  ssl_certificate_key /etc/nginx/certs/live/uep.example.com/privkey.pem;
  ```

- **Leave the HSTS line commented for now.** See [the HSTS warning](#a-warning-about-hsts).

Then check and restart:

```bash
docker compose exec frontend nginx -t     # must say "test is successful"
docker compose restart frontend
```

Visit `https://uep.example.com`. You should see a padlock.

### 5. Prove renewal works

Do not skip this. A certificate that fails to renew takes the site down 90 days
from now, and by then nobody will remember what changed.

```bash
docker compose run --rm certbot renew --dry-run
```

Look for `Congratulations, all simulated renewals succeeded`.

Renewal writes the new certificate but nginx keeps serving the old one from
memory until it reloads. Add a weekly reload — run `crontab -e` on the host and
add:

```
0 4 * * 1 cd /path/to/USO-Platform && docker compose exec -T frontend nginx -s reload
```

---

## Route B: a certificate from your own organisation

On an internal server there is no public domain to verify, so Let's Encrypt
cannot be used. Instead your organisation's IT department issues the
certificate from its own certificate authority (CA).

This is the normal arrangement for internal systems and it is just as secure —
the difference is that browsers only trust it on machines that have your
organisation's CA installed, which for company-managed computers is usually
already the case.

### 1. Create a certificate request

On the server, in a directory you can find again:

```bash
mkdir -p ~/uep-certs && cd ~/uep-certs

openssl req -new -newkey rsa:2048 -nodes \
  -keyout uep.key \
  -out uep.csr \
  -subj "/C=IR/O=Your Organisation/CN=uep.internal.example"
```

Replace `uep.internal.example` with the exact address staff type into their
browser. If they use a bare hostname *and* a fully qualified one, mention both
to IT so the certificate covers both.

This produces two files:

- `uep.csr` — the request. **Send this to IT.** It contains no secret.
- `uep.key` — the private key. **Never send this to anyone.** Anyone holding it
  can impersonate the server.

```bash
chmod 600 uep.key
```

### 2. Ask IT for

- The signed certificate for `uep.csr` (usually `.crt` or `.pem`).
- **The intermediate/chain certificates.** Ask explicitly. A missing chain is
  the single most common cause of "it works on my machine but not on hers".
- Confirmation that the organisation's root CA is already installed on staff
  computers. If it is not, IT needs to push it out, or every user sees a
  security warning.
- The expiry date. Write it in a calendar with a reminder a month before —
  internal certificates usually do **not** renew automatically, and this is the
  step that gets forgotten.

### 3. Assemble the files

nginx wants the server certificate and the chain in one file, server
certificate first:

```bash
cd ~/uep-certs
cat uep.crt intermediate.crt > fullchain.pem
cp uep.key privkey.pem
chmod 600 privkey.pem
```

### 4. Give the container the files

In `docker-compose.yml`, under the `frontend` service, uncomment the volume lines
and point them at your directory:

```yaml
    volumes:
      - /root/uep-certs:/etc/nginx/certs:ro
```

`:ro` means read-only — the container can read the certificate but cannot alter it.

Also uncomment the HTTPS port on that same service:

```yaml
      - "443:8443"
```

> **A note on ports.** The frontend container runs as an unprivileged user, so
> inside the container nginx listens on **8080** and **8443**, not 80 and 443.
> `docker-compose.yml` maps the host's real 80 and 443 onto those. You never
> type the internal numbers into a browser.

### 5. Turn HTTPS on

In `frontend/nginx.conf`:

- Comment out the plain-HTTP server block at the top.
- Uncomment the HTTPS block (the redirect block too, so plain HTTP forwards).
- Set `server_name` to the internal address in both blocks.
- The certificate paths are already correct for this layout:

  ```nginx
  ssl_certificate     /etc/nginx/certs/fullchain.pem;
  ssl_certificate_key /etc/nginx/certs/privkey.pem;
  ```

- **Leave the HSTS line commented for now.** See below.

Then:

```bash
docker compose up -d
docker compose exec frontend nginx -t     # must say "test is successful"
docker compose restart frontend
```

### 6. Check it from a normal staff computer

Not from the server itself. Open the address in a browser and confirm a padlock
with no warning. If there is a warning saying the certificate is not trusted,
the organisation's root CA is not installed on that machine — go back to IT.

### Renewal

Put a calendar reminder **one month before expiry**. When the new certificate
arrives, repeat step 3 and then:

```bash
docker compose restart frontend
```

---

## A warning about HSTS

The HTTPS block contains this line, commented out:

```nginx
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
```

It tells browsers "never use plain HTTP for this site again". That is a genuine
security improvement, and it is also the one setting in this document that can
lock you out.

Once a browser has seen it, it remembers for the full `max-age` — a year — and
**there is no way to cancel it remotely**. If the certificate later expires and
is not renewed, users do not get a warning they can click past; the site simply
stops loading for them.

So:

1. Leave it commented until HTTPS has been working for a few weeks.
2. Turn it on with a short lifetime first — change `31536000` to `300` (five
   minutes) and confirm nothing breaks.
3. Only then raise it to the full year.

For **Route B especially**, where renewal is manual, consider leaving HSTS off
entirely. The benefit is modest on an internal network; the failure mode is a
site nobody can reach.

---

## After HTTPS is on: two settings to update

### 1. `CORS_ORIGINS`

In `.env` on the server, this must match the new address exactly, including
`https://`:

```
CORS_ORIGINS=https://uep.example.com
```

The application refuses to start if this is `*`, so if you get it wrong the
backend will tell you. Restart with `docker compose up -d backend`.

### 2. Tell people the address changed

Anyone with `http://…` bookmarked will be redirected automatically, but it is
worth asking staff to update their bookmarks so the first request is never sent
in plain text.

---

## If something goes wrong

**nginx will not start after the change.**
Almost always a wrong certificate path. Check with:

```bash
docker compose logs frontend | tail -20
```

To get the site back immediately: re-comment the HTTPS block, uncomment the
plain-HTTP block, and `docker compose restart frontend`. Then work out the path
without the site being down.

**Browser says "not secure" / "certificate not trusted".**
Route A: the domain in the certificate does not match the address typed.
Route B: the organisation's root CA is not installed on that computer, or the
intermediate chain is missing from `fullchain.pem`.

**The site loads but has no styling and Farsi text looks wrong.**
The Google Fonts import in `src/styles/app.css` cannot be reached — likely on an
internal server with no route to the public internet. This is not a TLS problem
and is worth fixing regardless; see `FINDINGS.md`.

**Everything looks right but the login page cannot reach the API.**
`CORS_ORIGINS` in `.env` still names the old `http://` address. Fix it and
restart the backend.
