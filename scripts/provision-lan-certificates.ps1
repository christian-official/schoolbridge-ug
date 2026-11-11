param([Parameter(Mandatory=$true)][string]$BindAddress)
#requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$PackageDir = $PSScriptRoot
$InstallDir = Join-Path $env:ProgramData "SchoolBridge"
$SecretDir = Join-Path $InstallDir "secrets"
$Python = Join-Path $InstallDir "runtime/python.exe"
$Provisioner = Join-Path $PackageDir "provision-lan-certificates.py"
$EnvFile = Join-Path $InstallDir ".env"
if (-not (Test-Path $Python -PathType Leaf)) { throw "Installed SchoolBridge Python runtime not found at $Python." }
if (-not (Test-Path $Provisioner -PathType Leaf)) { throw "Certificate provisioning program is missing from this package." }
if (-not (Test-Path $EnvFile -PathType Leaf)) { throw "Installed SchoolBridge .env configuration is missing." }
$null = New-Item -ItemType Directory -Force -Path $SecretDir
# The CA and server private keys are readable only by the installing operator and SYSTEM.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
& icacls.exe $SecretDir /reset /T /C | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not reset existing LAN certificate directory permissions." }
& icacls.exe $SecretDir /inheritance:r /grant:r "$($identity):(OI)(CI)F" "SYSTEM:(OI)(CI)F" /T /C | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not restrict permissions on the LAN certificate directory and its existing files." }
$export = Join-Path ([Environment]::GetFolderPath("Desktop")) "SchoolBridge-LAN-Root-CA.pem"
& $Python $Provisioner --bind-ip $BindAddress --secret-dir $SecretDir --env-file $EnvFile --export-ca $export
if ($LASTEXITCODE -ne 0) { throw "LAN certificate provisioning failed. LAN remains disabled." }
Write-Host ""
Write-Host "Public root certificate exported to: $export"
Write-Host "Install that PUBLIC certificate as a trusted CA on each authorised client device."
Write-Host "Never copy lan-root-ca-key.pem or lan-server-key.pem to a phone, USB drive, or staff device."
Write-Host "LAN remains disabled. After client trust is installed, explicitly enable SCHOOLBRIDGE_LAN_ENABLED=true and configure the scoped firewall rule."
