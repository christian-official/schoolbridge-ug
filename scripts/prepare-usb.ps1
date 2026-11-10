$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PackageDir = Join-Path $RepoRoot "dist/SchoolBridge-USB"
$ComposeFile = Join-Path $RepoRoot "docker-compose.yml"
$RuntimeSource = Join-Path $RepoRoot "runtime"
$RequiredRuntime = @(
    (Join-Path $RuntimeSource "Docker Desktop Installer.exe"),
    (Join-Path $RuntimeSource "wsl.msi")
)

# Do not produce a package that appears installable offline but cannot prepare
# the Windows host without downloads.
$missingRuntime = @($RequiredRuntime | Where-Object { -not (Test-Path $_ -PathType Leaf) })
if ($missingRuntime.Count -gt 0) {
    throw ("Offline USB preparation blocked. Stage the official Microsoft/Docker installers first: " + ($missingRuntime -join ", "))
}
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

    # Start clean so files from an older build cannot mask missing artifacts.
    if (Test-Path $PackageDir) { Remove-Item $PackageDir -Recurse -Force }
    New-Item -ItemType Directory -Force -Path $PackageDir | Out-Null
    docker save -o (Join-Path $PackageDir "schoolbridge-images.tar") postgres:16-alpine schoolbridge/backend:local schoolbridge/frontend:local
    if ($LASTEXITCODE -ne 0) { throw "Could not export container images." }
    if (-not (Test-Path (Join-Path $PackageDir "schoolbridge-images.tar") -PathType Leaf)) { throw "The exported image archive is missing." }

    $PackageCompose = Get-Content $ComposeFile -Raw
    $PackageCompose = [regex]::Replace($PackageCompose, '(?m)^    build:\r?\n      context: \./(backend|frontend)\r?\n', '')
    if ($PackageCompose -match '(?m)^    build:') { throw "USB Compose package still contains source build contexts." }
    Set-Content (Join-Path $PackageDir "docker-compose.yml") $PackageCompose -Encoding UTF8
    Copy-Item (Join-Path $PSScriptRoot "install-schoolbridge.ps1") $PackageDir -Force
    Copy-Item (Join-Path $PSScriptRoot "check-school-host.ps1") $PackageDir -Force
    Copy-Item (Join-Path $PSScriptRoot "prepare-school-host.ps1") $PackageDir -Force
    Copy-Item $RuntimeSource (Join-Path $PackageDir "runtime") -Recurse -Force

    $GuideDir = Join-Path $PackageDir "docs"
    New-Item -ItemType Directory -Force -Path $GuideDir | Out-Null
    foreach ($guide in @("USB_INSTALLATION.md", "WINDOWS_RUNTIME_PREPARATION.md", "SCHOOL_READINESS_AND_INSTALLATION.md")) {
        $source = Join-Path $RepoRoot ("docs/" + $guide)
        if (-not (Test-Path $source -PathType Leaf)) { throw "Required installation guide is missing: $source" }
        Copy-Item $source $GuideDir -Force
    }

    @'
# Add the owner's Base64 public verification key before starting SchoolBridge.
SCHOOLBRIDGE_LICENSE_PUBLIC_KEY=
SCHOOLBRIDGE_PORT=8080
SCHOOLBRIDGE_BACKUP_RETENTION_DAYS=30
SCHOOLBRIDGE_BACKUP_INTERVAL_HOURS=24
'@ | Set-Content (Join-Path $PackageDir ".env.example") -Encoding ASCII

    # A manifest lets the receiving school verify that USB files were copied intact.
    Get-ChildItem $PackageDir -File -Recurse |
        Where-Object { $_.Name -ne "SHA256SUMS.txt" } |
        ForEach-Object {
            $hash = Get-FileHash $_.FullName -Algorithm SHA256
            $relative = $_.FullName.Substring($PackageDir.Length).TrimStart([IO.Path]::DirectorySeparatorChar)
            "$($hash.Hash)  $relative"
        } | Set-Content (Join-Path $PackageDir "SHA256SUMS.txt") -Encoding ASCII

    Write-Host "Complete offline USB package prepared at $PackageDir"
    Write-Host "Verify SHA256SUMS.txt after copying the folder to the USB drive."
}
finally { Pop-Location }
