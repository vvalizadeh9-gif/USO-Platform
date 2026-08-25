# Deploying from Windows, and auto-deploy from GitHub

UEP itself still runs as Docker Compose on a Linux server — that part of
`RUNBOOK.md` is unchanged. This document covers two additions that sit on top
of it:

1. **`scripts/deploy.ps1`** — a PowerShell script for a Windows workstation
   that triggers a deploy over SSH, so you don't need a Linux terminal to
   ship a change by hand.
2. **`.github/workflows/deploy.yml`** — a GitHub Actions workflow that does
   the same thing automatically, once the test suite has passed on `main`.

Both drive the same script on the server, `scripts/remote-deploy.sh`, so a
manual deploy and an automatic one behave identically: pull → back up →
`docker compose up -d --build` → wait for the backend and frontend to report
healthy.

```
Windows workstation                 GitHub Actions ("Deploy" workflow)
  deploy.ps1                          on: Tests workflow succeeds on main
      │  ssh (your key)                   │  ssh (DEPLOY_SSH_KEY secret)
      ▼                                   ▼
                    Linux server (DEPLOY_PATH)
                    git fetch + merge --ff-only
                    ./scripts/remote-deploy.sh
                         │  git pull already done above
                         ▼
                    backup.sh → docker compose up -d --build → health check
```

Nothing here changes how the application runs, and neither path ever copies
files from your machine or the Actions runner to the server — the server
always pulls its own code from GitHub over its own SSH key. That means two
separate SSH relationships to set up:

- **GitHub → server**: lets `deploy.ps1` and the Actions workflow log in and
  run commands.
- **Server → GitHub**: lets `git fetch`/`git pull` on the server read the
  (presumably private) repository.

---

## One-time server setup

Do this once, on the Linux server, in addition to the [first-time
setup](RUNBOOK.md#first-time-setup) in `RUNBOOK.md`.

### 1. A dedicated deploy user

Don't deploy as `root`. Create a user that can run Docker and nothing else it
doesn't need:

```bash
sudo adduser --disabled-password --gecos "" deploy
sudo usermod -aG docker deploy
```

Being in the `docker` group is enough to run `docker compose` — no `sudo`
needed, and none should be granted.

### 2. Let the server pull from GitHub

Generate a key pair *on the server*, for the `deploy` user, dedicated to
reading this one repository:

```bash
sudo -iu deploy
ssh-keygen -t ed25519 -C "uep-server-deploy-key" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
```

Add that public key in GitHub under **Repository → Settings → Deploy keys →
Add deploy key**. Leave **Allow write access** unchecked — the server only
ever needs to read.

Then clone the repository as the `deploy` user, at the path you'll use as
`DEPLOY_PATH`/`RemotePath` everywhere below:

```bash
sudo mkdir -p /opt/USO-Platform
sudo chown deploy:deploy /opt/USO-Platform
sudo -iu deploy
git clone git@github.com:<owner>/<repo>.git /opt/USO-Platform
cd /opt/USO-Platform
./scripts/setup-env.sh          # first-time only — see RUNBOOK.md
docker compose up -d --build    # first-time only, to confirm it all works
```

### 3. Let GitHub Actions / your workstation log in as `deploy`

Generate a **second, separate** key pair — this one is what `deploy.ps1` and
the Actions workflow use to *reach* the server. Generate it wherever is
convenient (your workstation, or the server); only the public half goes on
the server:

```bash
ssh-keygen -t ed25519 -C "uep-deploy-access" -f uep_deploy_access -N ""
```

Append the `.pub` file's contents to the `deploy` user's
`~/.ssh/authorized_keys` on the server:

```bash
sudo -iu deploy
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "<contents of uep_deploy_access.pub>" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Keep `uep_deploy_access` (the private half) safe — you'll use it in both
places below.

---

## Manual deploy: `scripts/deploy.ps1`

**Requires:** the OpenSSH Client on Windows (`Settings → Apps → Optional
features → OpenSSH Client`, or it's already present on most Windows 10/11
installs — check with `ssh -V` in PowerShell).

Copy the config template and fill in your server:

```powershell
Copy-Item scripts\deploy.config.example.json scripts\deploy.config.json
notepad scripts\deploy.config.json
```

```json
{
  "ServerHost": "uep.example.com",
  "User": "deploy",
  "RemotePath": "/opt/USO-Platform",
  "Port": 22,
  "KeyPath": "C:\\Users\\you\\.ssh\\uep_deploy_access"
}
```

`deploy.config.json` is gitignored — it names your server, not a secret, but
it's specific to you, so it isn't committed.

Then, from the repository root in PowerShell:

```powershell
./scripts/deploy.ps1
```

It prints the server's current commit, asks you to type `deploy` to confirm,
then pulls `main`, backs up, rebuilds, and waits for the health check —
exactly like running the steps in `RUNBOOK.md` by hand. Pass `-WhatIf` to see
what it would do without doing it, or `-Branch some-other-branch` to deploy
something other than `main`.

It only fast-forwards (`git merge --ff-only`) — if the server's checkout has
diverged, it stops with an error rather than discarding anything. Sort that
out over a plain `ssh deploy@<server>` session; see `RUNBOOK.md`.

---

## Automatic deploy: GitHub Actions

`.github/workflows/deploy.yml` runs after the existing `Tests` workflow
succeeds on `main`, and does the same pull → back up → rebuild → health-check
sequence over SSH, using the *second* key pair from setup step 3.

### Repository secrets

**Settings → Secrets and variables → Actions → New repository secret:**

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | The server's hostname or IP |
| `DEPLOY_USER` | `deploy` |
| `DEPLOY_PATH` | `/opt/USO-Platform` (wherever you cloned it) |
| `DEPLOY_SSH_KEY` | The full contents of the **private** key `uep_deploy_access` |
| `DEPLOY_PORT` | Only if SSH isn't on port 22 |

### The `production` environment (recommended)

The workflow targets a GitHub **environment** called `production`. Creating
one (**Settings → Environments → New environment → `production`**) is
optional but worthwhile — it lets you require a manual approval before each
deploy runs, and scope the secrets above to only that environment rather than
every workflow in the repo. Without it, the workflow still runs fine using
repository-level secrets.

### What triggers it

Every push to `main` that passes `Tests` triggers a deploy — that's the "use
the updated version on GitHub automatically" part. You can also run it by
hand from the **Actions** tab (`Deploy` → `Run workflow`), e.g. to retry
after fixing a server-side problem without needing a new commit.

### Watching it / rolling back

Progress and logs are in the **Actions** tab, same as the `Tests` workflow.
If a deploy fails, `RUNBOOK.md`'s existing [Rolling back](RUNBOOK.md#rolling-back)
section applies unchanged — the server's data isn't touched until
`remote-deploy.sh` gets past the backup step, and the backup itself is a
safety net if the migration did run.

---

## Why not just `docker compose up -d --build` from a GitHub Actions runner directly?

The runner would need Docker socket access to your server, which means either
running a self-hosted runner on the server itself (a bigger attack surface —
it can execute arbitrary workflow code) or exposing the Docker API over the
network (which `docker-compose.yml`'s design deliberately avoids elsewhere,
e.g. not publishing the database port). SSHing in as a low-privilege
`deploy` user and running a fixed script is the smaller, more auditable
surface, and it's the same mechanism whether you trigger it from PowerShell
or from CI.
