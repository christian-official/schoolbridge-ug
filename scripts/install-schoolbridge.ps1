$ErrorActionPreference = "Stop"
$PackageDir = $PSScriptRoot
$ImageArchive = Join-Path $PackageDir "schoolbridge-images.tar"
$EnvFile = Join-Path $PackageDir ".env"

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw "Docker Engine is not installed. The current USB package does not bundle the runtime; install a compatible offline Docker runtime first." }
docker compose version | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Docker Compose v2 is required." }
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw "Docker Engine is not running. Start the local Docker service before installing." }
if (-not (Test-Path $ImageArchive)) { throw "Missing schoolbridge-images.tar. Recreate the USB package." }

if (-not (Test-Path $EnvFile)) {
    $dbBytes = New-Object byte[] 32
    $appBytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($dbBytes)
    $rng.GetBytes($appBytes)
    $dbPassword = [BitConverter]::ToString($dbBytes).Replace("-", "").ToLowerInvariant()
    $appSecret = [BitConverter]::ToString($appBytes).Replace("-", "").ToLowerInvariant()
    $rng.Dispose()
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
    Write-Host "Created local .env with randomly generated secrets."
}

Write-Host "Importing SchoolBridge images from USB..."
docker load -i $ImageArchive
if ($LASTEXITCODE -ne 0) { throw "Image import failed." }

$envLines = @(Get-Content $EnvFile)
$keyIndex = -1
for ($index = 0; $index -lt $envLines.Count; $index++) {
    if ($envLines[$index] -match '^SCHOOLBRIDGE_LICENSE_PUBLIC_KEY=(.*)
$confirmation = Read-Host "Start the local SchoolBridge services now? Type START"
if ($confirmation -cne "START") { Write-Host "Images imported. Start later with: docker compose up -d"; exit 0 }

Push-Location $PackageDir
try {
    docker compose up -d --no-build
    if ($LASTEXITCODE -ne 0) { throw "SchoolBridge failed to start. Inspect docker compose logs." }
    Write-Host "SchoolBridge startup requested. Open http://localhost:8080 on this computer."
    Write-Host "Check service health with: docker compose ps"
}
finally { Pop-Location }
) { $keyIndex = $index; $publicKey = $Matches[1]; break }
}
if ($keyIndex -lt 0 -or [string]::IsNullOrWhiteSpace($publicKey)) {
    $publicKey = Read-Host "Paste the owner's Base64 public verification key (not the private key)"
}
if ([string]::IsNullOrWhiteSpace($publicKey)) { throw "The owner's public verification key is required before first activation." }
try { $decodedPublicKey = [Convert]::FromBase64String($publicKey) } catch { throw "The public verification key must be valid Base64." }
if ($decodedPublicKey.Length -ne 32) { throw "The Ed25519 public key must decode to exactly 32 bytes." }
if ($keyIndex -ge 0) {
    $envLines[$keyIndex] = "SCHOOLBRIDGE_LICENSE_PUBLIC_KEY=$publicKey"
} else {
    $envLines += "SCHOOLBRIDGE_LICENSE_PUBLIC_KEY=$publicKey"
}
Set-Content $EnvFile $envLines -Encoding ASCII
$confirmation = Read-Host "Start the local SchoolBridge services now? Type START"
if ($confirmation -cne "START") { Write-Host "Images imported. Start later with: docker compose up -d"; exit 0 }

Push-Location $PackageDir
try {
    docker compose up -d --no-build
    if ($LASTEXITCODE -ne 0) { throw "SchoolBridge failed to start. Inspect docker compose logs." }
    Write-Host "SchoolBridge startup requested. Open http://localhost:8080 on this computer."
    Write-Host "Check service health with: docker compose ps"
}
finally { Pop-Location }
