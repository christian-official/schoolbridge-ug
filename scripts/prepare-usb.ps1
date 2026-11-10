$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$PackageDir = Join-Path $RepoRoot "dist/SchoolBridge-USB"
$ComposeFile = Join-Path $RepoRoot "docker-compose.yml"
$RuntimeSource = Join-Path $RepoRoot "runtime"
New-Item -ItemType Directory -Force -Path $RuntimeSource | Out-Null

# The preparation computer is online; the school computer is not.
# Download from official vendor endpoints and verify Authenticode signatures.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
function Get-VerifiedInstaller([string]$Path, [string]$Uri, [string]$PublisherPattern) {
    if (-not (Test-Path $Path -PathType Leaf)) {
        Write-Host "Downloading official runtime installer: $(Split-Path $Path -Leaf)"
        Invoke-WebRequest -Uri $Uri -OutFile $Path -UseBasicParsing
    }
    $signature = Get-AuthenticodeSignature -FilePath $Path
    if ($signature.Status -ne "Valid") {
        throw "Runtime installer signature is not valid: $Path ($($signature.Status))"
    }
    if ($signature.SignerCertificate.Subject -notmatch $PublisherPattern) {
        throw ("Unexpected runtime installer publisher for " + $Path + ": " + $signature.SignerCertificate.Subject)
    }
}
$DockerInstaller = Join-Path $RuntimeSource "Docker Desktop Installer.exe"
$WslInstaller = Join-Path $RuntimeSource "wsl.msi"
Get-VerifiedInstaller $DockerInstaller "https://desktop.docker.com/win/main/amd64/Docker%20Desktop%20Installer.exe" "Docker"
if (-not (Test-Path $WslInstaller -PathType Leaf)) {
    Write-Host "Resolving the latest stable Microsoft WSL x64 MSI..."
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/microsoft/WSL/releases/latest"
    $assets = @($release.assets | Where-Object { $_.name.ToLowerInvariant().EndsWith(".x64.msi") })
    if ($assets.Count -ne 1) { throw "Could not identify one official x64 WSL MSI in the latest stable release." }
    Invoke-WebRequest -Uri $assets[0].browser_download_url -OutFile $WslInstaller -UseBasicParsing
}
$wslSignature = Get-AuthenticodeSignature -FilePath $WslInstaller
if ($wslSignature.Status -ne "Valid" -or $wslSignature.SignerCertificate.Subject -notmatch "Microsoft Corporation") {
    throw "The staged WSL MSI does not have a valid Microsoft Authenticode signature."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker is required on the preparation computer." }
docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker Compose v2 is required." }
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine must be running on the preparation computer." }

# Compose validates required runtime variables even for an image-only build.
# Supply throwaway values so a clean preparation computer does not need a pre-existing
# school .env file, and never reuse or bake a real school secret into the USB package.
$composeBuildVariables = @("POSTGRES_PASSWORD", "SCHOOLBRIDGE_SECRET_KEY")
$previousComposeBuildEnvironment = @{}
foreach ($name in $composeBuildVariables) {
    $previousComposeBuildEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, "Process")
    [Environment]::SetEnvironmentVariable($name, [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N"), "Process")
}

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

    # Keep database traffic isolated while publishing only the frontend edge service.
    if (-not $PackageCompose.Contains("schoolbridge-internal:")) { throw "USB Compose internal network is missing." }
    if (-not $PackageCompose.Contains("internal: true")) { throw "USB Compose database network must be isolated." }
    if (-not $PackageCompose.Contains("schoolbridge-edge:")) { throw "USB Compose frontend edge network is missing." }

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
finally {
    Pop-Location
    foreach ($name in $composeBuildVariables) {
        [Environment]::SetEnvironmentVariable($name, $previousComposeBuildEnvironment[$name], "Process")
    }
}
