param(
    [string]$NativePackageDir = (Join-Path (Split-Path -Parent $PSScriptRoot) "dist/SchoolBridge-Native-Windows")
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$ResourcesDir = Join-Path $RepoRoot "frontend/desktop-resources"
$RuntimeDir = Join-Path $ResourcesDir "runtime"
$BackendSource = Join-Path $NativePackageDir "backend"
$PythonZip = Join-Path $NativePackageDir "python-3.12-embed-amd64.zip"
$GetPip = Join-Path $NativePackageDir "get-pip.py"
$Wheelhouse = Join-Path $NativePackageDir "wheelhouse"

foreach ($required in @(
    $BackendSource,
    (Join-Path $BackendSource "app/main.py"),
    (Join-Path $BackendSource "app/static/index.html"),
    (Join-Path $BackendSource "requirements.txt"),
    $PythonZip,
    $GetPip,
    $Wheelhouse
)) {
    if (-not (Test-Path $required)) {
        throw "Native package is incomplete; required desktop resource is missing: $required"
    }
}

if (Test-Path $ResourcesDir) {
    Remove-Item $ResourcesDir -Recurse -Force
}
$null = New-Item -ItemType Directory -Force -Path $ResourcesDir
Copy-Item $BackendSource (Join-Path $ResourcesDir "backend") -Recurse
$null = New-Item -ItemType Directory -Force -Path $RuntimeDir
Expand-Archive -LiteralPath $PythonZip -DestinationPath $RuntimeDir -Force

$Python = Join-Path $RuntimeDir "python.exe"
$PythonPathFile = Join-Path $RuntimeDir "python312._pth"
if (-not (Test-Path $Python -PathType Leaf) -or -not (Test-Path $PythonPathFile -PathType Leaf)) {
    throw "The supplied archive is not the expected CPython 3.12 x64 embeddable runtime."
}

$PathEntries = @(Get-Content $PythonPathFile | Where-Object {
    $_ -notmatch '^\s*#?\s*import site\s*$' -and
    $_ -notmatch '^\s*Lib\\site-packages\s*$' -and
    $_ -notmatch '^\s*\.\.\\backend\s*$'
})
$PathEntries += "Lib\site-packages"
$PathEntries += "..\backend"
$PathEntries += "import site"
Set-Content -LiteralPath $PythonPathFile -Value $PathEntries -Encoding ASCII

& $Python $GetPip --no-index --find-links $Wheelhouse
if ($LASTEXITCODE -ne 0) {
    throw "Could not bootstrap pip from the offline wheelhouse."
}
& $Python -m pip install --no-index --find-links $Wheelhouse --target (Join-Path $RuntimeDir "Lib/site-packages") -r (Join-Path $ResourcesDir "backend/requirements.txt")
if ($LASTEXITCODE -ne 0) {
    throw "Could not install every backend dependency into the bundled desktop runtime."
}
& $Python -c "import fastapi, uvicorn, sqlalchemy, jwt, cryptography, dotenv, pwdlib, qrcode"
if ($LASTEXITCODE -ne 0) {
    throw "The staged desktop runtime failed its backend import smoke test."
}
& $Python -m pip check
if ($LASTEXITCODE -ne 0) {
    throw "The staged desktop runtime contains incompatible Python dependencies."
}

Write-Host "Tauri desktop resources prepared at $ResourcesDir"
Write-Host "Bundled resource layout:"
Get-ChildItem $ResourcesDir -Directory | Select-Object Name
