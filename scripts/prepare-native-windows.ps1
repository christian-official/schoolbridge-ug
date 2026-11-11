param([Parameter(Mandatory=$true)][string]$PythonEmbedZip,[Parameter(Mandatory=$true)][string]$GetPipScript)
$ErrorActionPreference="Stop"
$RepoRoot=Split-Path -Parent $PSScriptRoot
$PackageDir=Join-Path $RepoRoot "dist/SchoolBridge-Native-Windows"
$FrontendDir=Join-Path $RepoRoot "frontend"
$BackendDir=Join-Path $RepoRoot "backend"
$PythonVersion=& python -c "import sys; print('%d.%d' % sys.version_info[:2])"
if($LASTEXITCODE -ne 0 -or $PythonVersion -ne "3.12"){throw "Preparation computer needs Python 3.12."}
if(-not(Test-Path $PythonEmbedZip -PathType Leaf)){throw "Supply official 64-bit Python 3.12 embeddable ZIP."}
if(-not(Test-Path $GetPipScript -PathType Leaf)){throw "Supply official get-pip.py."}
Push-Location $FrontendDir
try { npm ci; if($LASTEXITCODE -ne 0){throw "Frontend dependency installation failed."}; npm run build; if($LASTEXITCODE -ne 0){throw "Frontend production build failed."} } finally { Pop-Location }
if(Test-Path $PackageDir){Remove-Item $PackageDir -Recurse -Force}
$null=New-Item -ItemType Directory -Force -Path $PackageDir
$null=New-Item -ItemType Directory -Force -Path (Join-Path $PackageDir "backend")
$null=New-Item -ItemType Directory -Force -Path (Join-Path $PackageDir "wheelhouse")
Copy-Item (Join-Path $BackendDir "app") (Join-Path $PackageDir "backend/app") -Recurse
Copy-Item (Join-Path $BackendDir "requirements.txt") (Join-Path $PackageDir "backend/requirements.txt")
Copy-Item (Join-Path $BackendDir "alembic.ini") (Join-Path $PackageDir "backend/alembic.ini")
Copy-Item (Join-Path $BackendDir "migrations") (Join-Path $PackageDir "backend/migrations") -Recurse
Copy-Item (Join-Path $FrontendDir "dist") (Join-Path $PackageDir "backend/app/static") -Recurse
Copy-Item $PythonEmbedZip (Join-Path $PackageDir "python-3.12-embed-amd64.zip")
Copy-Item $GetPipScript (Join-Path $PackageDir "get-pip.py")
Copy-Item (Join-Path $PSScriptRoot "install-native-windows.ps1") $PackageDir
Copy-Item (Join-Path $PSScriptRoot "run-native-windows.ps1") $PackageDir
Copy-Item (Join-Path $PSScriptRoot "configure-lan-firewall.ps1") $PackageDir
Copy-Item (Join-Path $PSScriptRoot "provision-lan-certificates.ps1") $PackageDir
Copy-Item (Join-Path $PSScriptRoot "provision-lan-certificates.py") $PackageDir
Copy-Item (Join-Path $RepoRoot "docs/DESKTOP_LAN_ACCESS.md") $PackageDir
Copy-Item (Join-Path $PSScriptRoot "NATIVE_WINDOWS_INSTALLATION.md") $PackageDir
$wheelhouse=Join-Path $PackageDir "wheelhouse"
& python -m pip download --only-binary=:all: --platform win_amd64 --python-version 312 --implementation cp --abi cp312 --dest $wheelhouse -r (Join-Path $BackendDir "requirements.txt")
if($LASTEXITCODE -ne 0){throw "Could not resolve complete Windows CPython 3.12 wheelhouse. Do not omit dependencies."}
& python -m pip download --only-binary=:all: --platform win_amd64 --python-version 312 --implementation cp --abi cp312 --dest $wheelhouse pip
if($LASTEXITCODE -ne 0){throw "Could not stage pip bootstrap wheel."}
Get-ChildItem $PackageDir -File -Recurse | Where-Object {$_.Name -ne "SHA256SUMS.txt"} | ForEach-Object {
 $hash=Get-FileHash $_.FullName -Algorithm SHA256
 $relative=$_.FullName.Substring($PackageDir.Length).TrimStart([IO.Path]::DirectorySeparatorChar)
 "$($hash.Hash)  $relative"
} | Set-Content (Join-Path $PackageDir "SHA256SUMS.txt") -Encoding ASCII
Write-Host "Native Windows package prepared at $PackageDir"
