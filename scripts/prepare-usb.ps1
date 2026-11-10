$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PackageDir = Join-Path $RepoRoot "dist/SchoolBridge-USB"
$ComposeFile = Join-Path $RepoRoot "docker-compose.yml"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker is required on the preparation computer." }
docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker Compose v2 is required." }
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine must be running on the preparation computer." }

Push-Location $RepoRoot
try {
    docker pull postgres:16-alpine
    if ($LASTEXITCODE -ne 0) { throw "Could not pull PostgreSQL base image." }
    docker compose build backend frontend
    if ($LASTEXITCODE -ne 0) { throw "Container image build failed." }

    New-Item -ItemType Directory -Force -Path $PackageDir | Out-Null
    docker save -o (Join-Path $PackageDir "schoolbridge-images.tar") postgres:16-alpine schoolbridge/backend:local schoolbridge/frontend:local
    if ($LASTEXITCODE -ne 0) { throw "Could not export container images." }

    $PackageCompose = Get-Content $ComposeFile -Raw
    $PackageCompose = [regex]::Replace($PackageCompose, '(?m)^    build:\r?\n      context: \./(backend|frontend)\r?\n', '')
    if ($PackageCompose -match '(?m)^    build:') { throw "USB Compose package still contains source build contexts." }
    Set-Content (Join-Path $PackageDir "docker-compose.yml") $PackageCompose -Encoding UTF8
    Copy-Item (Join-Path $PSScriptRoot "install-schoolbridge.ps1") $PackageDir -Force
    Copy-Item (Join-Path $PSScriptRoot "check-school-host.ps1") $PackageDir -Force
    $RuntimeSource = Join-Path $RepoRoot "runtime"
    if (Test-Path $RuntimeSource) {
        Copy-Item $RuntimeSource (Join-Path $PackageDir "runtime") -Recurse -Force
    } else {
        Write-Warning "No runtime folder found. Add the official WSL and Docker Desktop offline installers under runtime before preparing the final school USB."
    }
    @'
# Add the owner's Base64 public verification key before starting SchoolBridge.
SCHOOLBRIDGE_LICENSE_PUBLIC_KEY=
SCHOOLBRIDGE_PORT=8080
SCHOOLBRIDGE_BACKUP_RETENTION_DAYS=30
SCHOOLBRIDGE_BACKUP_INTERVAL_HOURS=24
'@ | Set-Content (Join-Path $PackageDir ".env.example") -Encoding ASCII
    Write-Host "USB package prepared at $PackageDir"
    Write-Host "Copy the complete folder to a USB drive formatted as exFAT or NTFS."
}
finally { Pop-Location }
