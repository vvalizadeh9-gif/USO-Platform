<#
.SYNOPSIS
    Deploys UEP to the server from a Windows workstation.

.DESCRIPTION
    Runs the same steps as RUNBOOK.md's "Deploying" section, over SSH: pull
    the branch you specify, then back up the database, rebuild the Docker
    images, and confirm the backend and frontend come back healthy
    (scripts/remote-deploy.sh, run on the server).

    This does not copy files from your machine -- the server pulls the code
    itself from GitHub, the same way `git pull` on the server would. Your
    workstation only needs network access to the server's SSH port; it does
    not need Docker, and it never sees the server's .env or database.

    The pull is fast-forward only (`git merge --ff-only`), never a forced
    reset. If the server's checkout has diverged from the branch you're
    deploying, this stops with an error instead of discarding anything --
    see RUNBOOK.md and sort it out over a plain `ssh` session.

    See WINDOWS-DEPLOY.md for one-time setup (SSH keys, the server-side
    deploy user, GitHub Actions auto-deploy).

.PARAMETER ServerHost
    Hostname or IP of the server. Falls back to $env:UEP_DEPLOY_HOST, then to
    scripts/deploy.config.json.

.PARAMETER User
    SSH username on the server. Falls back to $env:UEP_DEPLOY_USER, then
    scripts/deploy.config.json.

.PARAMETER RemotePath
    Path to the repository on the server (the directory holding
    docker-compose.yml). Falls back to $env:UEP_DEPLOY_PATH, then
    scripts/deploy.config.json.

.PARAMETER Branch
    Branch to deploy. Default: main.

.PARAMETER Port
    SSH port. Default: 22.

.PARAMETER KeyPath
    Path to a private key file, if you don't want to rely on the default SSH
    identity or an ssh-agent.

.EXAMPLE
    ./scripts/deploy.ps1 -ServerHost uep.example.com -User deploy -RemotePath /opt/USO-Platform

.EXAMPLE
    # With scripts/deploy.config.json holding host/user/path, just:
    ./scripts/deploy.ps1

.EXAMPLE
    # See what would run without doing anything:
    ./scripts/deploy.ps1 -WhatIf
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$ServerHost,
    [string]$User,
    [string]$RemotePath,
    [string]$Branch = "main",
    [int]$Port = 22,
    [string]$KeyPath
)

$ErrorActionPreference = "Stop"

# --- Load defaults from deploy.config.json, if present -----------------------
# Not secret (just host/user/path), but environment-specific, so it is
# gitignored -- copy deploy.config.example.json to start one.
$ConfigPath = Join-Path $PSScriptRoot "deploy.config.json"
if (Test-Path $ConfigPath) {
    $Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    if (-not $ServerHost -and $Config.ServerHost) { $ServerHost = $Config.ServerHost }
    if (-not $User -and $Config.User) { $User = $Config.User }
    if (-not $RemotePath -and $Config.RemotePath) { $RemotePath = $Config.RemotePath }
    if (-not $PSBoundParameters.ContainsKey('Port') -and $Config.Port) { $Port = $Config.Port }
    if (-not $KeyPath -and $Config.KeyPath) { $KeyPath = $Config.KeyPath }
}

if (-not $ServerHost) { $ServerHost = $env:UEP_DEPLOY_HOST }
if (-not $User) { $User = $env:UEP_DEPLOY_USER }
if (-not $RemotePath) { $RemotePath = $env:UEP_DEPLOY_PATH }

if (-not $ServerHost -or -not $User -or -not $RemotePath) {
    Write-Error @"
Missing server details. Provide -ServerHost, -User and -RemotePath, or create
scripts/deploy.config.json (copy scripts/deploy.config.example.json) with:
  { "ServerHost": "...", "User": "...", "RemotePath": "/opt/USO-Platform" }
"@
    exit 1
}

if (-not (Get-Command ssh -ErrorAction SilentlyContinue)) {
    Write-Error "ssh was not found. Install the OpenSSH Client (Settings -> Apps -> Optional Features on Windows 10/11), then try again."
    exit 1
}

$SshTarget = "$User@$ServerHost"
$SshArgs = @("-p", $Port)
if ($KeyPath) { $SshArgs += @("-i", $KeyPath) }

function Invoke-Remote {
    param([string]$Command)
    Write-Host ">> ssh ${SshTarget}: $Command" -ForegroundColor DarkGray
    & ssh @SshArgs $SshTarget $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Remote command failed (exit $LASTEXITCODE): $Command"
    }
}

Write-Host "=== UEP deploy: $ServerHost`:$RemotePath, branch $Branch ===" -ForegroundColor Cyan

# --- 0. Reachability check ----------------------------------------------------
Write-Host "`n--- Checking connection ---" -ForegroundColor Cyan
Invoke-Remote "cd '$RemotePath' && git rev-parse --short HEAD"

# --- 1. Confirm -----------------------------------------------------------
if (-not $PSCmdlet.ShouldProcess("$ServerHost ($RemotePath)", "pull $Branch, back up, and rebuild")) {
    exit 0
}
$Confirm = Read-Host "About to pull '$Branch', back up, and rebuild on $ServerHost. Type 'deploy' to continue"
if ($Confirm -ne "deploy") {
    Write-Host "Cancelled. Nothing was changed." -ForegroundColor Yellow
    exit 1
}

# --- 2. Pull the branch (fast-forward only) ------------------------------
Write-Host "`n--- Pulling $Branch ---" -ForegroundColor Cyan
Invoke-Remote "cd '$RemotePath' && git fetch origin $Branch && git merge --ff-only origin/$Branch"

# --- 3. Back up, build, start, wait for healthy --------------------------
Write-Host "`n--- Backing up, building and starting (scripts/remote-deploy.sh) ---" -ForegroundColor Cyan
Invoke-Remote "cd '$RemotePath' && ./scripts/remote-deploy.sh"

Write-Host "`n=== Deploy finished. Open the site and check one real screen before you go. ===" -ForegroundColor Green
