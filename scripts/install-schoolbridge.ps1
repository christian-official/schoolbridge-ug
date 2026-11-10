$ErrorActionPreference = "Stop"

$PackageDir = $PSScriptRoot
$ImageArchive = Join-Path $PackageDir "schoolbridge-images.tar"
$EnvFile = Join-Path $PackageDir ".env"
$ComposeFile = Join-Path $PackageDir "docker-compose.yml"
$HostCheck = Join-Path $PackageDir "check-school-host.ps1"
$RuntimePreparation = Join-Path $PackageDir "prepare-school-host.ps1"

foreach ($required in @($ComposeFile, $HostCheck, $RuntimePreparation, $ImageArchive)) {
    if (-not (Test-Path $required -PathType Leaf)) {
        throw "Incomplete SchoolBridge USB package. Missing: $required. Recreate the complete USB package."
    }
}

$Manifest = Join-Path $PackageDir "SHA256SUMS.txt"
if (-not (Test-Path $Manifest -PathType Leaf)) { throw "USB integrity manifest is missing: SHA256SUMS.txt." }
$packageRoot = [IO.Path]::GetFullPath($PackageDir).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
foreach ($entry in Get-Content $Manifest) {
    if ([string]::IsNullOrWhiteSpace($entry)) { continue }
    if ($entry -notmatch '^([A-Fa-f0-9]{64})  (.+)
if (-not (Test-Path (Join-Path $PackageDir "runtime/Docker Desktop Installer.exe") -PathType Leaf) -or
    -not (Test-Path (Join-Path $PackageDir "runtime/wsl.msi") -PathType Leaf)) {
    throw "The official Docker Desktop and WSL installers are missing. This package is not ready for offline installation."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is not installed. First run prepare-school-host.ps1 from an elevated PowerShell window, complete the interactive Docker setup, restart if requested, then rerun this installer."
}

Write-Host "Checking this computer before installing SchoolBridge..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $HostCheck
$hostCheckExit = $LASTEXITCODE
if ($hostCheckExit -ne 0) {
    throw "This computer is not ready for installation. Run prepare-school-host.ps1 elevated, resolve the reported blockers, then rerun this installer."
}

docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker Compose v2 is required." }
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running. Start Docker Desktop and wait for its engine to become ready." }

if (-not (Test-Path $EnvFile)) {
    $dbBytes = New-Object byte[] 32
    $appBytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($dbBytes); $rng.GetBytes($appBytes) }
    finally { $rng.Dispose() }
    $dbPassword = [BitConverter]::ToString($dbBytes).Replace("-", "").ToLowerInvariant()
    $appSecret = [BitConverter]::ToString($appBytes).Replace("-", "").ToLowerInvariant()
    @"
POSTGRES_DB=schoolbridge
POSTGRES_USER=schoolbridge
POSTGRES_PASSWORD=$dbPassword
SCHOOLBRIDGE_SECRET_KEY=$appSecret
SCHOOLBRIDGE_LICENSE_PUBLIC_KEY=
SCHOOLBRIDGE_PORT=8080
SCHOOLBRIDGE_CORS_ORIGINS=*
SCHOOLBRIDGE_BACKUP_RETENTION_DAYS=30
SCHOOLBRIDGE_BACKUP_INTERVAL_HOURS=24
"@ | Set-Content $EnvFile -Encoding ASCII
    Write-Host "Created local .env with fresh random database and application secrets."
}

$envLines = @(Get-Content $EnvFile)
$keyIndex = -1
$publicKey = ""
for ($index = 0; $index -lt $envLines.Count; $index++) {
    if ($envLines[$index] -match '^SCHOOLBRIDGE_LICENSE_PUBLIC_KEY=(.*)$') {
        $keyIndex = $index; $publicKey = $Matches[1]; break
    }
}
if ([string]::IsNullOrWhiteSpace($publicKey)) {
    $publicKey = Read-Host "Paste the owner's Base64 public verification key (not the private key)"
}
if ([string]::IsNullOrWhiteSpace($publicKey)) { throw "The owner's public verification key is required before first activation." }
try { $decodedPublicKey = [Convert]::FromBase64String($publicKey) }
catch { throw "The public verification key must be valid Base64." }
if ($decodedPublicKey.Length -ne 32) { throw "The Ed25519 public key must decode to exactly 32 bytes." }
if ($keyIndex -ge 0) { $envLines[$keyIndex] = "SCHOOLBRIDGE_LICENSE_PUBLIC_KEY=$publicKey" }
else { $envLines += "SCHOOLBRIDGE_LICENSE_PUBLIC_KEY=$publicKey" }
Set-Content $EnvFile $envLines -Encoding ASCII

Write-Host "Importing SchoolBridge images from USB..."
docker load -i $ImageArchive
if ($LASTEXITCODE -ne 0) { throw "Image import failed." }

$confirmation = Read-Host "Start local SchoolBridge services now? Type START"
if ($confirmation -cne "START") {
    Write-Host "Images imported. Start later with: docker compose up -d"
    exit 0
}

Push-Location $PackageDir
try {
    docker compose up -d --no-build
    if ($LASTEXITCODE -ne 0) { throw "SchoolBridge failed to start. Inspect docker compose logs." }
    Write-Host "SchoolBridge startup requested. Open http://localhost:8080 on this computer."
    Write-Host "Check service health with: docker compose ps"
}
finally { Pop-Location }
) { throw "Invalid SHA256 manifest entry: $entry" }
    $expectedHash = $Matches[1].ToUpperInvariant()
    $relativePath = $Matches[2]
    $filePath = [IO.Path]::GetFullPath((Join-Path $PackageDir $relativePath))
    if (-not $filePath.StartsWith($packageRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe path in USB integrity manifest: $relativePath"
    }
    if (-not (Test-Path $filePath -PathType Leaf)) { throw "USB package file is missing: $relativePath" }
    $actualHash = (Get-FileHash $filePath -Algorithm SHA256).Hash
    if ($actualHash -ne $expectedHash) { throw "USB package integrity check failed: $relativePath" }
}
Write-Host "USB package integrity verified."

if (-not (Test-Path (Join-Path $PackageDir "runtime/Docker Desktop Installer.exe") -PathType Leaf) -or
    -not (Test-Path (Join-Path $PackageDir "runtime/wsl.msi") -PathType Leaf)) {
    throw "The official Docker Desktop and WSL installers are missing. This package is not ready for offline installation."
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "Docker is not installed. First run prepare-school-host.ps1 from an elevated PowerShell window, complete the interactive Docker setup, restart if requested, then rerun this installer."
}

Write-Host "Checking this computer before installing SchoolBridge..."
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $HostCheck
$hostCheckExit = $LASTEXITCODE
if ($hostCheckExit -ne 0) {
    throw "This computer is not ready for installation. Run prepare-school-host.ps1 elevated, resolve the reported blockers, then rerun this installer."
}

docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker Compose v2 is required." }
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running. Start Docker Desktop and wait for its engine to become ready." }

if (-not (Test-Path $EnvFile)) {
    $dbBytes = New-Object byte[] 32
    $appBytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($dbBytes); $rng.GetBytes($appBytes) }
    finally { $rng.Dispose() }
    $dbPassword = [BitConverter]::ToString($dbBytes).Replace("-", "").ToLowerInvariant()
    $appSecret = [BitConverter]::ToString($appBytes).Replace("-", "").ToLowerInvariant()
    @"
POSTGRES_DB=schoolbridge
POSTGRES_USER=schoolbridge
POSTGRES_PASSWORD=$dbPassword
SCHOOLBRIDGE_SECRET_KEY=$appSecret
SCHOOLBRIDGE_LICENSE_PUBLIC_KEY=
SCHOOLBRIDGE_PORT=8080
SCHOOLBRIDGE_CORS_ORIGINS=*
SCHOOLBRIDGE_BACKUP_RETENTION_DAYS=30
SCHOOLBRIDGE_BACKUP_INTERVAL_HOURS=24
"@ | Set-Content $EnvFile -Encoding ASCII
    Write-Host "Created local .env with fresh random database and application secrets."
}

$envLines = @(Get-Content $EnvFile)
$keyIndex = -1
$publicKey = ""
for ($index = 0; $index -lt $envLines.Count; $index++) {
    if ($envLines[$index] -match '^SCHOOLBRIDGE_LICENSE_PUBLIC_KEY=(.*)$') {
        $keyIndex = $index; $publicKey = $Matches[1]; break
    }
}
if ([string]::IsNullOrWhiteSpace($publicKey)) {
    $publicKey = Read-Host "Paste the owner's Base64 public verification key (not the private key)"
}
if ([string]::IsNullOrWhiteSpace($publicKey)) { throw "The owner's public verification key is required before first activation." }
try { $decodedPublicKey = [Convert]::FromBase64String($publicKey) }
catch { throw "The public verification key must be valid Base64." }
if ($decodedPublicKey.Length -ne 32) { throw "The Ed25519 public key must decode to exactly 32 bytes." }
if ($keyIndex -ge 0) { $envLines[$keyIndex] = "SCHOOLBRIDGE_LICENSE_PUBLIC_KEY=$publicKey" }
else { $envLines += "SCHOOLBRIDGE_LICENSE_PUBLIC_KEY=$publicKey" }
Set-Content $EnvFile $envLines -Encoding ASCII

Write-Host "Importing SchoolBridge images from USB..."
docker load -i $ImageArchive
if ($LASTEXITCODE -ne 0) { throw "Image import failed." }

$confirmation = Read-Host "Start local SchoolBridge services now? Type START"
if ($confirmation -cne "START") {
    Write-Host "Images imported. Start later with: docker compose up -d"
    exit 0
}

Push-Location $PackageDir
try {
    docker compose up -d --no-build
    if ($LASTEXITCODE -ne 0) { throw "SchoolBridge failed to start. Inspect docker compose logs." }
    Write-Host "SchoolBridge startup requested. Open http://localhost:8080 on this computer."
    Write-Host "Check service health with: docker compose ps"
}
finally { Pop-Location }
