#!/usr/bin/env bash
#
# Prepare a fresh Ubuntu or Debian server to run UEP.
#
#     sudo ./scripts/bootstrap-server.sh
#
# Run this once, on a newly installed machine, before ./scripts/setup-env.sh.
# It is safe to run again: every step checks whether it has already been done.
#
# What it installs:
#     - Docker Engine and the Compose plugin, from Docker's own repository
#       (NOT `apt install docker.io`, which is an older fork and ships
#       `docker-compose` v1, whose syntax this project does not use)
#     - git, openssl, curl -- needed to fetch the code and generate secrets
#     - a firewall allowing only SSH, HTTP and HTTPS
#     - automatic security updates
#     - swap, if the machine has less than 4 GB of RAM, because the frontend
#       build runs out of memory without it and fails with an unhelpful
#       "Killed" message
#
# What it deliberately does NOT do:
#     - create .env          (that is scripts/setup-env.sh, run as your user)
#     - start the containers (that is `docker compose up -d --build`)
#     - touch an existing installation's data
#
# See SERVER-SETUP-TUTORIAL.md for what each of these steps means and why.

set -euo pipefail

# --- Preconditions ---------------------------------------------------------

if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: run this with sudo -- it installs system packages." >&2
    echo "       sudo $0" >&2
    exit 1
fi

if [ ! -r /etc/os-release ]; then
    echo "ERROR: cannot read /etc/os-release, so the distribution is unknown." >&2
    exit 1
fi

# shellcheck disable=SC1091
. /etc/os-release

# Docker publishes separate repositories for Debian and Ubuntu. Derivatives
# (Linux Mint, Pop!_OS, Raspberry Pi OS) are not the same as their parent as far
# as apt is concerned: they carry their own codename, which does not exist in
# Docker's repository, so the codename has to come from the UBUNTU_CODENAME /
# DEBIAN_CODENAME fields the derivative inherits.
case "${ID:-}" in
    ubuntu)
        DOCKER_DISTRO="ubuntu"
        DOCKER_CODENAME="${UBUNTU_CODENAME:-${VERSION_CODENAME:-}}"
        ;;
    debian)
        DOCKER_DISTRO="debian"
        DOCKER_CODENAME="${VERSION_CODENAME:-}"
        ;;
    *)
        # ID_LIKE tells us what the derivative is built on.
        case " ${ID_LIKE:-} " in
            *ubuntu*)
                DOCKER_DISTRO="ubuntu"
                DOCKER_CODENAME="${UBUNTU_CODENAME:-}"
                ;;
            *debian*)
                DOCKER_DISTRO="debian"
                DOCKER_CODENAME="${DEBIAN_CODENAME:-${VERSION_CODENAME:-}}"
                ;;
            *)
                echo "ERROR: this script handles Ubuntu and Debian only." >&2
                echo "       Found: ${PRETTY_NAME:-$ID}" >&2
                echo "       Install Docker by hand: https://docs.docker.com/engine/install/" >&2
                exit 1
                ;;
        esac
        ;;
esac

if [ -z "$DOCKER_CODENAME" ]; then
    echo "ERROR: could not determine the release codename for $DOCKER_DISTRO." >&2
    echo "       Install Docker by hand: https://docs.docker.com/engine/install/" >&2
    exit 1
fi

echo
echo "  Preparing this server for UEP"
echo "  ============================="
echo "  Distribution : ${PRETTY_NAME:-$ID}"
echo "  Docker repo  : $DOCKER_DISTRO / $DOCKER_CODENAME"
echo "  Architecture : $(dpkg --print-architecture)"
echo

# Stops apt asking interactive questions (service restarts, changed config
# files) part-way through and hanging forever on a machine nobody is watching.
export DEBIAN_FRONTEND=noninteractive

# --- 1. Base packages ------------------------------------------------------

echo "==> Updating the package list and installing base tools"
apt-get update -qq
apt-get install -y -qq \
    ca-certificates \
    curl \
    gnupg \
    git \
    openssl \
    ufw \
    unattended-upgrades

# --- 2. Docker -------------------------------------------------------------

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "==> Docker and the Compose plugin are already installed; skipping"
else
    echo "==> Removing any distribution Docker packages"
    # These conflict with Docker's own packages. `|| true` because apt exits
    # non-zero when asked to remove something that was never installed, which
    # is the normal case on a fresh machine and is not an error here.
    apt-get remove -y -qq \
        docker.io docker-doc docker-compose docker-compose-v2 \
        podman-docker containerd runc 2>/dev/null || true

    echo "==> Adding Docker's signing key"
    # The key proves the packages came from Docker. Without it apt would either
    # refuse to install them or, worse, accept packages from whoever answered
    # the request.
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL "https://download.docker.com/linux/${DOCKER_DISTRO}/gpg" \
        -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc

    echo "==> Adding Docker's package repository"
    cat > /etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${DOCKER_DISTRO} ${DOCKER_CODENAME} stable
EOF

    echo "==> Installing Docker Engine, buildx and the Compose plugin"
    apt-get update -qq
    apt-get install -y -qq \
        docker-ce \
        docker-ce-cli \
        containerd.io \
        docker-buildx-plugin \
        docker-compose-plugin

    systemctl enable --now docker
fi

echo "    $(docker --version)"
echo "    $(docker compose version)"

# --- 3. Let the deploying user run docker without sudo ---------------------

# SUDO_USER is the account that called sudo. It is empty when logged in as root
# directly, in which case there is no separate user to add.
DEPLOY_USER="${SUDO_USER:-}"
if [ -n "$DEPLOY_USER" ] && [ "$DEPLOY_USER" != "root" ]; then
    if id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -qx docker; then
        echo "==> $DEPLOY_USER is already in the docker group"
    else
        echo "==> Adding $DEPLOY_USER to the docker group"
        usermod -aG docker "$DEPLOY_USER"
        echo "    Log out and back in for this to take effect."
    fi
    # Membership of the docker group is equivalent to root: anyone in it can
    # start a container that mounts the whole filesystem. Worth knowing before
    # adding a second person to it.
fi

# --- 4. Swap, if memory is tight -------------------------------------------

MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
if [ "$MEM_MB" -lt 3800 ] && [ ! -e /swapfile ]; then
    echo "==> Only ${MEM_MB} MB of RAM; adding a 4 GB swap file"
    # The frontend build (Vite + esbuild) peaks well above 1 GB. Without swap
    # the kernel kills it and the build fails with a bare "Killed", which looks
    # like a broken Dockerfile rather than an out-of-memory condition.
    fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    if ! grep -q '^/swapfile' /etc/fstab; then
        echo '/swapfile none swap sw 0 0' >> /etc/fstab
    fi
    echo "    Swap is on and will come back after a reboot."
elif [ -e /swapfile ]; then
    echo "==> Swap file already present; skipping"
else
    echo "==> ${MEM_MB} MB of RAM is enough; no swap needed"
fi

# --- 5. Firewall -----------------------------------------------------------

echo "==> Configuring the firewall"
# Order matters: allow SSH BEFORE enabling, or enabling the firewall closes the
# connection you are typing this over and locks you out of the machine.
ufw allow 22/tcp    comment 'SSH'    >/dev/null
ufw allow 80/tcp    comment 'HTTP'   >/dev/null
ufw allow 443/tcp   comment 'HTTPS'  >/dev/null

if ufw status | head -1 | grep -q inactive; then
    ufw --force enable >/dev/null
    echo "    Firewall enabled."
else
    echo "    Firewall was already enabled; rules refreshed."
fi
ufw status numbered | sed 's/^/    /'

# Note: Docker publishes ports by writing its own iptables rules, which bypass
# ufw. docker-compose.yml only publishes port 80 (and 443 once TLS is on), and
# PostgreSQL and the backend use `expose`, not `ports`, so they are reachable
# only from inside the Compose network. Adding `ports:` to the db service would
# expose PostgreSQL to the internet regardless of the rules above.

# --- 6. Automatic security updates -----------------------------------------

echo "==> Enabling automatic security updates"
# Applies security patches to the host. It does not update the containers --
# their base images are pinned by digest in the Dockerfiles and are updated
# deliberately; see RUNBOOK.md, "Updating a pinned base image".
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

# --- 7. Prove Docker actually works ----------------------------------------

echo "==> Testing that Docker can pull and run an image"
if docker run --rm hello-world >/dev/null 2>&1; then
    echo "    Success -- Docker can reach a registry and run containers."
else
    cat <<'EOF'
    FAILED to pull hello-world.

    Docker is installed, but it could not download an image. Almost always
    this is the network, not Docker. Check, in this order:

      1. DNS      : docker run --rm alpine nslookup registry-1.docker.io
      2. Outbound : curl -sSf https://registry-1.docker.io/v2/ -o /dev/null
      3. Blocking : if you are in a country Docker Hub refuses to serve,
                    you will get 403 Forbidden. Configure a registry mirror
                    in /etc/docker/daemon.json -- see the "If Docker Hub is
                    blocked" section of SERVER-SETUP-TUTORIAL.md.

    Fix this before continuing: the UEP build downloads Python, Node,
    PostgreSQL and nginx images and cannot proceed without a registry.
EOF
    exit 1
fi

# --- Done ------------------------------------------------------------------

cat <<EOF

  ---------------------------------------------------------------
  This server is ready.

  Next:

    1. If you were added to the docker group just now, log out and
       back in, or the next command will say "permission denied":

         exit

    2. Get the code:

         git clone https://github.com/vvalizadeh9-gif/USO-Platform.git
         cd USO-Platform

    3. Create the secrets, and WRITE DOWN what it prints:

         ./scripts/setup-env.sh

    4. Build and start:

         docker compose up -d --build

    5. Check it:

         docker compose ps
         docker compose logs backend | head -40

  Full explanation of every step: SERVER-SETUP-TUTORIAL.md
  Day-to-day operations:          RUNBOOK.md
  ---------------------------------------------------------------

EOF
