# Setting up a UEP server, from a Windows machine

A teaching document. It takes a bare server and ends with UEP running on it,
explaining what each step does and why — so that the second time, on the MTNi
server, you can do it without this file open.

Every command is given in full. Commands you type **in PowerShell on your
Windows PC** are marked `PS>`. Commands you type **on the server, after logging
in** are marked `$`. Getting these two confused is the single most common
mistake, so the prompt is always shown.

**Contents**

1. [The mental model](#1-the-mental-model)
2. [PowerShell is a terminal, not a control panel](#2-powershell-is-a-terminal-not-a-control-panel)
3. [Reinstalling the operating system](#3-reinstalling-the-operating-system)
4. [The first ten minutes on a fresh server](#4-the-first-ten-minutes-on-a-fresh-server)
5. [Installing Docker](#5-installing-docker)
6. [Installing UEP](#6-installing-uep)
7. [Checking it actually works](#7-checking-it-actually-works)
8. [The things you must do before calling it live](#8-the-things-you-must-do-before-calling-it-live)
9. [Doing this on the MTNi server](#9-doing-this-on-the-mtni-server)
10. [When something goes wrong](#10-when-something-goes-wrong)
11. [Cheat sheet](#11-cheat-sheet)

---

## 1. The mental model

Before any commands, get the shape of it in your head. Five layers, each sitting
on the one below:

```
   UEP            the application: backend, frontend, database
     ▲
   Docker Compose  one file describing which containers run and how they connect
     ▲
   Docker Engine   runs containers
     ▲
   Linux           Ubuntu, on the server
     ▲
   The machine     a computer in a data centre, reachable at 82.39.165.72
```

You will build this from the bottom up. Each layer is independent: you can
destroy UEP without touching Docker, and reinstall Linux without touching the
machine.

Three ideas do most of the work:

**A container is a program plus everything it needs to run.** UEP's backend
needs Python 3.12, a particular version of FastAPI, and a dozen other libraries.
Rather than installing those onto the server — where they would collide with
whatever else is installed, and drift over time — they are packaged into an
*image*, and the image is run as a *container*. The server itself stays almost
empty. This is why the install below is short: you are not installing Python,
PostgreSQL or nginx at all. You are installing Docker, and Docker fetches the
rest.

**Compose describes the whole system in one file.** `docker-compose.yml` in this
repository says: run PostgreSQL, run the backend, run nginx; put them on a
private network; let nginx be reachable from outside on port 80 and keep the
other two hidden. Read the top of that file — it is heavily commented and is the
real documentation for how the parts fit together.

**Containers are disposable; volumes are not.** Rebuilding an image throws the
container away and makes a new one. Anything written inside a container dies
with it. That is fine for code and libraries, and catastrophic for the database,
so the database and the uploaded files live in *named volumes* — storage Docker
manages separately, which survives rebuilds. `docker compose down` stops
everything and keeps the volumes. `docker compose down -v` deletes them, and
with them every village record and every uploaded letter. Never type that on the
server.

---

## 2. PowerShell is a terminal, not a control panel

This is worth stating plainly because it shapes what follows.

PowerShell on your Windows PC gives you a way to *type commands on the server*.
It does not give you power over the machine itself. The distinction matters most
for the very first task you asked about — reinstalling the OS — because that is
one of the few things SSH cannot do. You cannot pull the floor out from under
yourself while standing on it.

What PowerShell does give you is `ssh`, `scp` and `ssh-keygen`, built into
Windows 10 and 11. No PuTTY, no extra downloads.

Check they are there:

```powershell
PS> ssh -V
```

You should see something like `OpenSSH_for_Windows_9.5p1`. If instead you get
"not recognized", the optional feature is missing — install it from
**Settings → System → Optional features → Add → OpenSSH Client**.

### Confirming the server is reachable at all

Before trying to log in, check the port is open. This separates "wrong password"
from "the machine is off" — two problems that otherwise look similar:

```powershell
PS> Test-NetConnection 82.39.165.72 -Port 22
```

`TcpTestSucceeded : True` means something is listening on port 22. `False` means
the machine is down, the firewall is blocking you, or SSH is on a different
port. No password will help you until that says True.

### Logging in

```powershell
PS> ssh root@82.39.165.72
```

The first time, you will be asked to confirm a fingerprint:

```
The authenticity of host '82.39.165.72' can't be established.
ED25519 key fingerprint is SHA256:xxxxxxxx...
Are you sure you want to continue connecting (yes/no/[fingerprint])?
```

Type `yes`. Windows records that fingerprint in
`C:\Users\<you>\.ssh\known_hosts` and from then on checks it on every
connection — that is what stops someone impersonating your server.

**Remember this, because it will bite you in section 3:** reinstalling the OS
generates a *new* host key. Your PC will then refuse to connect, with a large
alarming warning about a possible man-in-the-middle attack. That warning is
correct in general and wrong in this specific case. The fix is one command,
given at the end of section 3.

---

## 3. Reinstalling the operating system

### The honest answer

**You cannot reinstall the OS from PowerShell.** Not through SSH, not with any
command. SSH is a program running *inside* the operating system you want to
erase; wiping the disk kills the process serving your session before the install
finishes, and you are left with a half-erased machine you can no longer reach.

Reinstalling always happens *outside* the running system, and there are exactly
three ways to arrange that. Which one applies to you depends entirely on who
provides the machine.

### Route A — the provider's control panel (almost certainly yours)

Every VPS and dedicated-server company gives you a web panel with a **Reinstall**
or **Rebuild** button. You choose an image, confirm, and a few minutes later the
machine boots into a clean OS with a fresh root password emailed to you or shown
on screen.

Under the hood the provider boots the machine from *their* environment, not
yours, which is precisely what SSH cannot do.

Where to look, by provider:

| Provider | Where |
|---|---|
| Hetzner | Cloud Console → the server → **Rebuild** |
| OVH / SoYouStart / Kimsufi | Manager → Dedicated → **Reinstall** |
| Contabo | Customer panel → **Reinstall** |
| DigitalOcean | Droplet → Destroy → **Rebuild** |
| Vultr / Linode | Server → Settings → **Reinstall** / **Rebuild** |
| Iranian hosts (Arvan, Parspack, Iranserver…) | Panel → نصب مجدد سیستم‌عامل |

**Choose Ubuntu 24.04 LTS**, minimal or standard image, no control panel, no
pre-installed software. LTS means five years of security updates. A "minimal"
image is preferable because everything UEP needs arrives in containers, so
anything else pre-installed is only more to patch.

Do not pick an image that comes with cPanel, Plesk, or a pre-baked LAMP stack.
Those manage ports 80 and 443 themselves and will fight nginx for them.

### Route B — rescue mode

If the panel has no reinstall button but does have **Rescue mode**, that works
too. Rescue boots the machine into a small Linux running *in memory* rather than
off the disk — so the disk is idle and can be overwritten. You SSH into the
rescue system and run the provider's installer, commonly:

```
$ installimage        # Hetzner and several others
```

which offers a menu of distributions, partitioning, and hostname. This is more
control and more ways to get it wrong; use Route A if it is offered.

### Route C — IPMI / iKVM / a mounted ISO

For a machine you own — which the MTNi server may well be — there is no hosting
panel. Instead the server's motherboard has a management chip (Dell calls it
iDRAC, HP calls it iLO, Supermicro just calls it IPMI) with its own IP address
and its own web interface, reachable whether the operating system is running or
not.

From there you get a remote screen and keyboard, you can mount an Ubuntu ISO as
a virtual DVD drive, and you install exactly as you would sitting in front of
it. This is the route where "reinstall the OS remotely" genuinely means
attaching a virtual disc from the other side of the world.

The management interface must never be exposed to the internet. It is a small
computer with a long history of vulnerabilities and it has total control of the
hardware. Keep it on the management VLAN and reach it over the VPN.

### Before you press the button

Reinstalling erases the disk. If anything on that machine matters:

```powershell
PS> scp -r root@82.39.165.72:/root/USO-Platform/.env C:\Users\<you>\Desktop\backup\
```

and if UEP is already running there with real data, take a database dump first
(`./scripts/backup.sh`, see `BACKUP-RUNBOOK.md`) and copy the resulting file off
the machine. The `.env` file in particular is worth rescuing: it holds the
database password, it is deliberately excluded from git, and if it is lost the
existing database cannot be opened.

### After the reinstall: the warning you were promised

Try to log in and Windows will refuse:

```
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @
@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@
```

Your PC remembers the old server's fingerprint and the new install has a
different one. Tell it to forget:

```powershell
PS> ssh-keygen -R 82.39.165.72
PS> ssh root@82.39.165.72
```

Accept the new fingerprint and you are in.

Understand what you just did, though, because the same message appears when
someone really is intercepting your connection. It is safe to clear the key
*because you know why it changed* — you reinstalled the machine sixty seconds
ago. If this message ever appears when you have not touched the server, stop and
investigate.

---

## 4. The first ten minutes on a fresh server

You are logged in as root on a clean Ubuntu. Do these five things before
anything else.

### 4.1 Change the root password

```
$ passwd
```

Do this immediately on any server whose password arrived by email, was typed
into a chat window, or was given to you by someone else. A password that has
travelled in plain text should be considered public.

### 4.2 Update everything

```
$ apt update && apt upgrade -y
```

The installed image was built weeks or months ago; this catches up on security
fixes. If it finishes by asking you to reboot, do:

```
$ reboot
```

Your session drops. Wait thirty seconds and SSH back in.

### 4.3 Create a user that is not root

```
$ adduser uep
$ usermod -aG sudo uep
```

`adduser` asks for a password and some details you can leave blank. `usermod
-aG sudo` lets that user run administrative commands by prefixing them with
`sudo`.

Why bother, when you have the root password? Because root can do anything with
no confirmation, so every typo is potentially fatal, and nothing in the log
distinguishes you from anyone else who knows the password. Working as `uep` and
typing `sudo` when you mean it gives you a pause before destructive commands and
a record of who did what.

### 4.4 Set up key-based login

A password can be guessed; an SSH key cannot in any practical sense. Servers on
the public internet see automated password-guessing attempts within minutes of
coming online.

**On your PC**, make a key if you have not already:

```powershell
PS> ssh-keygen -t ed25519 -C "uep-server"
```

Press Enter to accept the default location. When it asks for a passphrase, use
one — it encrypts the key file, so a stolen laptop does not mean a stolen
server.

You now have two files in `C:\Users\<you>\.ssh\`:

- `id_ed25519` — the **private** key. Never leaves your PC. Never emailed,
  never pasted into a chat.
- `id_ed25519.pub` — the **public** key. Safe to hand out; it is what goes on
  the server.

Windows has no `ssh-copy-id`, so copy it across like this:

```powershell
PS> type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh uep@82.39.165.72 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

That reads the public key locally, pipes it over SSH, and appends it to the
`authorized_keys` file the server checks at login. The `chmod` commands matter:
SSH ignores these files if they are readable by other users, and does so
silently, which makes it a confusing failure.

Test it from a **new** PowerShell window, keeping your current session open:

```powershell
PS> ssh uep@82.39.165.72
```

It should log you straight in, asking only for your key's passphrase.

> Keep the first window open until the new method is proven. This is the general
> rule for every change to remote access: verify the new way works before you
> close the old way. It is the difference between a mistake and a trip to the
> data centre.

### 4.5 Turn off password logins

Only once key login is confirmed working:

```
$ sudo nano /etc/ssh/sshd_config
```

Find and set these three lines (remove any leading `#`):

```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

Save with `Ctrl+O`, `Enter`, then exit with `Ctrl+X`. Check the file parses
before restarting — this command catches typos that would otherwise stop SSH
from starting at all:

```
$ sudo sshd -t
$ sudo systemctl restart ssh
```

Silence from `sshd -t` means it is valid. Now the only way in is a key you hold,
and the password from that chat window is worthless to anyone.

---

## 5. Installing Docker

### The short way

The repository ships a script that does the whole of this section. Get the code
first:

```
$ git clone https://github.com/vvalizadeh9-gif/USO-Platform.git
$ cd USO-Platform
$ sudo ./scripts/bootstrap-server.sh
```

It installs Docker, adds you to the `docker` group, sets up a firewall, enables
automatic security updates, adds swap if memory is tight, and finishes by
proving Docker can actually pull an image. It is safe to run twice.

Then log out and back in — group membership only applies to new sessions:

```
$ exit
PS> ssh uep@82.39.165.72
```

**Read the rest of this section anyway.** The script exists so you do not make a
typo, not so you can skip understanding it. On the MTNi server something will
behave differently, and you will need to know which step is failing.

### The long way, explained

#### Why not `apt install docker.io`?

Ubuntu ships a package called `docker.io`. It is an older, community-maintained
fork, usually a year or more behind, and the matching `docker-compose` package
is version 1 — a separate Python program with a different command name
(`docker-compose`, with a hyphen) and meaningfully different behaviour. This
project's `docker-compose.yml` uses `depends_on: condition: service_healthy`,
which Compose v1 does not support. Installing the distribution package
therefore produces a confusing failure at the last step, so you install from
Docker's own repository instead.

#### 1. Prerequisites

```
$ sudo apt update
$ sudo apt install -y ca-certificates curl gnupg
```

`ca-certificates` is the list of certificate authorities that lets the machine
verify HTTPS connections; `gnupg` verifies package signatures.

#### 2. Docker's signing key

```
$ sudo install -m 0755 -d /etc/apt/keyrings
$ curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /tmp/docker.asc
$ sudo mv /tmp/docker.asc /etc/apt/keyrings/docker.asc
$ sudo chmod a+r /etc/apt/keyrings/docker.asc
```

Every package Docker publishes is signed with this key. Adding it lets apt check
that a downloaded package genuinely came from Docker and was not altered
in transit. Skipping this step does not merely produce a warning — apt refuses
to install from an unsigned source.

#### 3. Docker's repository

```
$ echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

Long, but it is only filling in three blanks: your CPU architecture (`amd64` or
`arm64`), the key from the previous step, and your Ubuntu release codename
(`noble` for 24.04, `jammy` for 22.04). Run the middle part on its own to see
what it produces:

```
$ . /etc/os-release && echo "$VERSION_CODENAME"
noble
```

#### 4. Install

```
$ sudo apt update
$ sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Five packages:

| Package | What it is |
|---|---|
| `docker-ce` | the daemon — the background service that actually runs containers |
| `docker-ce-cli` | the `docker` command you type |
| `containerd.io` | the lower-level runtime the daemon uses |
| `docker-buildx-plugin` | the modern image builder |
| `docker-compose-plugin` | adds `docker compose` (a subcommand, note the space) |

#### 5. Confirm

```
$ docker --version
$ docker compose version
$ sudo docker run --rm hello-world
```

That last command pulls a tiny image from Docker Hub and runs it. It is the real
test: it proves the daemon is running, the network reaches a registry, and
containers can start. If it prints "Hello from Docker!", the layer is done.

#### 6. Run docker without sudo

```
$ sudo usermod -aG docker $USER
$ exit
```

Log back in and `docker ps` works without `sudo`.

Know what you have granted: anyone in the `docker` group can start a container
that mounts the host's entire filesystem, which makes them root by another
route. It is a convenience for the person who administers the machine, not a
group to add colleagues to casually.

#### 7. The firewall

```
$ sudo ufw allow 22/tcp
$ sudo ufw allow 80/tcp
$ sudo ufw allow 443/tcp
$ sudo ufw enable
```

**Allow 22 before enabling.** Enable the firewall first and you cut off the
connection you are typing over, and only the provider's console can save you.

One caveat you should know about, because it surprises people: Docker writes its
own iptables rules when it publishes a port, and those rules bypass ufw. So a
service published with `ports:` in `docker-compose.yml` is reachable from the
internet even if ufw does not list it. This project is written with that in
mind — only the frontend uses `ports:`; PostgreSQL and the backend use `expose:`,
which is Compose-network-only. If you ever add `ports:` to the `db` service to
"just have a look with pgAdmin", you will have put PostgreSQL on the public
internet.

---

## 6. Installing UEP

Three commands, but the middle one is the one to understand.

### 6.1 Get the code

```
$ git clone https://github.com/vvalizadeh9-gif/USO-Platform.git
$ cd USO-Platform
```

If you already cloned it in section 5, just `cd USO-Platform`.

### 6.2 Generate the secrets

```
$ ./scripts/setup-env.sh
```

It asks one question — the address people will type into their browser. For a
first test, that is:

```
http://82.39.165.72
```

Later, when there is a domain name and HTTPS, it becomes
`https://uep.example.com`; that is a one-line edit to `.env` plus a restart, and
`TLS-SETUP.md` covers it.

The script then generates three secrets with `openssl rand` — the JWT signing
key, the database password, and a first admin password — writes them to `.env`
with permissions `600` (readable only by you), and prints the admin login
**once**.

> **Write down the username and password it prints, before you close the
> window.** They are not shown again.

Two things about `.env` worth internalising now:

**It is the only copy of the database password.** It is excluded from git on
purpose, so it is not backed up along with your code. If you lose it, the
database cannot be opened — the data is still on the disk and is unreadable.
Put a copy wherever your organisation stores passwords.

**The backend refuses to start on the example values.** If `.env` goes missing
or fails to mount, every setting silently falls back to a default published in
this public repository — including the key that signs login tokens, which would
let anyone who read the repository sign themselves an admin session. So the
application checks at startup and stops with a clear message instead. If you
ever see "The application will not start with this configuration", that check
is doing its job; `RUNBOOK.md` explains each case.

### 6.3 Build and start

```
$ docker compose up -d --build
```

Expect three to ten minutes the first time. Reading the output as it goes will
teach you more than this document can. Roughly, it:

1. downloads the PostgreSQL, Python, Node and nginx base images
2. builds the backend image — installs the Python dependencies
3. builds the frontend image — runs `npm ci`, then `npm run build`, producing
   static HTML and JavaScript, then copies just those into an nginx image and
   throws the Node toolchain away (this is what "multi-stage build" means, and
   it is why the served image is small)
4. starts PostgreSQL and waits for its healthcheck to pass
5. starts the backend, which applies the database migrations and then serves
6. starts nginx

`-d` means detached — it runs in the background and gives you your prompt back.
`--build` means rebuild the images rather than reuse what is cached; you want
this after any code change.

Step 4 is worth pausing on. The backend depends on the database being *healthy*,
not merely *started*. PostgreSQL takes a while to initialise a fresh data
directory on first run, and without that wait the backend would start,
fail to connect, and exit. The `depends_on: condition: service_healthy` in
`docker-compose.yml` is what prevents it.

---

## 7. Checking it actually works

```
$ docker compose ps
```

You want every service `running`, with `db` and `backend` also `healthy`:

```
NAME                    STATUS
uso-platform-backend-1  Up 2 minutes (healthy)
uso-platform-db-1       Up 2 minutes (healthy)
uso-platform-frontend-1 Up 2 minutes (healthy)
```

`(health: starting)` on the backend is normal for the first two minutes — it is
allowed a long start-up window because migrations run before it serves.

Then the log:

```
$ docker compose logs backend | head -40
```

The three lines that mean success:

```
[entrypoint] Applying database migrations...
[entrypoint] Migrations applied.
[entrypoint] Starting API server...
```

Then check the API answers, from the server itself:

```
$ curl -i http://localhost/api/health
```

`HTTP/1.1 200 OK` means nginx is up, it is proxying `/api/` correctly, and the
backend is behind it and alive. This one command exercises the whole chain.

Finally, from your PC, open a browser at:

```
http://82.39.165.72
```

Sign in with the admin username and password `setup-env.sh` printed.

**Then look at a real screen — Acceptance, or Work Items.** A backend that
starts is not the same as an application that works. Log in, click into
something with data behind it, and confirm it renders. That is the check that
means you are finished.

Change the admin password after your first sign-in, via **Admin → Users →
Edit**. There is also an **Admin → System Health** screen showing whether the
database is reachable and whether migrations are current — useful because it
needs no terminal, so a non-technical colleague can check it.

---

## 8. The things you must do before calling it live

Getting it running is not the same as putting it into service. Three more, in
order of urgency.

**Backups, tonight.** `scripts/backup.sh` exists; nothing runs it until you set
up a nightly cron job. An untested backup is not a backup, so `BACKUP-RUNBOOK.md`
also has a restore drill — do it once now, and every six months after. The point
of the drill is not the backup file; it is finding out whether *you* can restore
under pressure.

**HTTPS.** Right now the login page sends the password over plain HTTP, readable
by anyone between the browser and the server. `TLS-SETUP.md` covers both routes:
Let's Encrypt if the server has a public domain name, or a certificate from your
own organisation's CA if it is internal — which is likely the MTNi case.

**Read `RUNBOOK.md` once, before you need it.** It covers deploying, rolling
back, restoring, rotating the signing key, resetting a forgotten admin password,
and what to do when the backend will not start. Reading it calmly now is much
easier than reading it at eleven at night with the site down.

---

## 9. Doing this on the MTNi server

Same five layers, three differences that will actually stop you.

### Docker Hub may be unreachable

This is the one that catches people out, and it is worth testing *first*, before
you have committed to anything:

```
$ curl -sS -o /dev/null -w '%{http_code}\n' https://registry-1.docker.io/v2/
```

`401` is good — the registry answered and is asking you to authenticate, which
is the normal response. `403` means Docker Hub is refusing to serve your
location. A timeout means the network is blocking it.

Same test for the packages themselves:

```
$ curl -sS -o /dev/null -w '%{http_code}\n' https://download.docker.com/linux/ubuntu/gpg
```

If either fails, you have two options.

**Option 1 — a registry mirror.** Point Docker at a mirror that is reachable
from your network:

```
$ sudo nano /etc/docker/daemon.json
```

```json
{
  "registry-mirrors": ["https://<the-mirror-your-network-provides>"]
}
```

```
$ sudo systemctl restart docker
```

Ask MTNi's infrastructure team what mirror they run — a company that size
usually has an internal registry or a Nexus/Artifactory proxy, and using theirs
is better than a public one. Public Iranian mirrors have a habit of changing
address or disappearing.

Note that this project pins its base images by SHA-256 digest, not by tag. That
is a help, not a hindrance: a digest names the exact bytes, so an image pulled
through any mirror is provably identical to the one pinned. If a mirror does not
have the digest, you get a clean "manifest unknown" rather than a silently
different image.

**Option 2 — carry the images in by hand.** More work, but it needs the target
server to have no internet access at all, which for an internal telecoms network
is a realistic constraint.

On a machine that *can* reach Docker Hub — the server you are setting up now
would do — build everything and save it to files:

```
$ docker compose build
$ docker save -o uep-images.tar \
    uso-platform-backend uso-platform-frontend \
    postgres@sha256:44c4ee9810eff91f7eab4d822642e01115b1a9eccce4bcbdde7604752d68eac6
```

(Check the built image names with `docker images` — Compose derives them from
the directory name, so a differently-named directory gives different names.)

That produces one large file. Copy it across, along with the source:

```powershell
PS> scp uep-images.tar uep@<mtni-server>:/home/uep/
```

And on the MTNi server:

```
$ docker load -i uep-images.tar
$ cd USO-Platform
$ ./scripts/setup-env.sh
$ docker compose up -d          # note: NO --build
```

Omitting `--build` is the whole point — it uses the images you carried in
instead of trying to build, which would need the internet again.

Docker itself can be installed offline the same way: download the `.deb` files
from `download.docker.com` on a connected machine, copy them over, and
`sudo dpkg -i *.deb`.

### The address will be internal, and so will the certificate

`CORS_ORIGINS` in `.env` must match exactly what people type in the browser —
scheme, host and port. An internal address like `https://uep.mtn.ir` or
`http://10.20.30.40` is fine; it just has to match. Get it wrong and the login
page loads but every API call is refused, which looks like a broken application
and is actually a one-line configuration mismatch.

For HTTPS, MTNi will have its own certificate authority rather than using Let's
Encrypt, since an internal name cannot be validated publicly. That is Route B in
`TLS-SETUP.md`: generate a CSR, send it to IT, get back a certificate, mount it
into the frontend container.

### Talk to whoever runs the network first

Before the day itself, confirm: which ports are open inbound, whether outbound
HTTPS works at all, whether there is an internal registry, what the DNS name
will be, who issues certificates, and where backups are allowed to be stored.
Each of these is a five-minute email now and a blocked afternoon if you discover
it on the day.

---

## 10. When something goes wrong

| Symptom | What it usually is | What to do |
|---|---|---|
| `Test-NetConnection` says False | machine down, or firewall | Check the provider's panel; use their web console |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | the OS was reinstalled | `ssh-keygen -R 82.39.165.72`, then reconnect |
| `Permission denied (publickey)` | key not installed, or file permissions wrong | `ssh -v uep@…` to see which keys it tried; check `~/.ssh` is `700` and `authorized_keys` is `600` |
| `permission denied` from `docker` | you are not in the `docker` group yet | Log out and back in — group changes need a new session |
| `docker: command not found` after install | the repo step targeted the wrong codename | Check `/etc/apt/sources.list.d/docker.list` names your release |
| `hello-world` fails, 403 | Docker Hub blocked from your location | Section 9, registry mirror |
| Frontend build dies with `Killed` | out of memory during `npm run build` | Add swap — the bootstrap script does this automatically |
| `port is already allocated` | something else holds port 80 | `sudo ss -tlnp \| grep :80`; often Apache or nginx installed by a panel image |
| Backend restarts in a loop | bad `.env`, or a failed migration | `docker compose logs backend \| head -40` — the message names the setting |
| "will not start with this configuration" | `.env` missing, or still example values | Re-run `./scripts/setup-env.sh`; `RUNBOOK.md` §"When the backend will not start" |
| Login page loads, API calls fail | `CORS_ORIGINS` does not match the address | Edit `.env`, `docker compose up -d backend` |

The habit that matters more than any of these: **read the log before changing
anything.**

```
$ docker compose logs backend | head -40
```

This project's error messages are written to name the problem exactly. Changing
things at random in the hope that one works is how a broken deployment becomes
an unrecoverable one — you lose track of what you have altered, and the original
fault is still there underneath.

---

## 11. Cheat sheet

**On Windows, in PowerShell**

```powershell
Test-NetConnection 82.39.165.72 -Port 22    # is it reachable?
ssh uep@82.39.165.72                        # log in
ssh-keygen -t ed25519 -C "uep-server"       # make a key
ssh-keygen -R 82.39.165.72                  # forget a changed host key
scp file.xlsx uep@82.39.165.72:/home/uep/   # copy a file up
scp uep@82.39.165.72:/home/uep/f.sql .      # copy a file down
```

**On the server**

```bash
cd ~/USO-Platform                # everything below runs from here

docker compose ps                # what is running, and is it healthy
docker compose logs -f backend   # follow the backend log (Ctrl+C to stop)
docker compose up -d --build     # start, or restart after a code change
docker compose restart backend   # restart one service
docker compose down              # stop everything, KEEP the data

./scripts/backup.sh              # back up the database — before every deploy
df -h                            # disk space; a full disk stops PostgreSQL
docker system df                 # how much of it Docker is using
docker system prune -a           # reclaim space from unused images (safe:
                                 # it does not touch named volumes)
```

**The one command never to run on the server**

```bash
docker compose down -v           # deletes the database and every upload
```

---

## Where to go next

| Document | What it covers |
|---|---|
| `README.md` | What UEP is and how the code is laid out |
| `ARCHITECTURE.md` | The domain: sites, villages, the health-check lifecycle, roles |
| `RUNBOOK.md` | Deploying, rolling back, restoring, and getting out of trouble |
| `BACKUP-RUNBOOK.md` | Backups, and the restore drill that proves they work |
| `TLS-SETUP.md` | Turning on HTTPS, public or internal |
| `MIGRATION-RUNBOOK.md` | Database migrations and what their errors mean |
| `FINDINGS.md` | Known issues left alone deliberately, and why |
