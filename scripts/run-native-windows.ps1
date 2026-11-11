$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Python = Join-Path $Root "runtime/python.exe"

if (-not (Test-Path $Python -PathType Leaf)) {
    throw "SchoolBridge Python runtime missing."
}

$EnvFile = Join-Path $Root ".env"
if (-not (Test-Path $EnvFile -PathType Leaf)) {
    throw "SchoolBridge configuration missing."
}

# Load configuration before importing app.database; it captures the database URL
# when Python imports the module.
foreach ($line in Get-Content -LiteralPath $EnvFile) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
        $name = $Matches[1]
        $value = $Matches[2].Trim()

        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or
            ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        [Environment]::SetEnvironmentVariable($name, $value, "Process")
    }
}

$env:PYTHONPATH = Join-Path $Root "backend"
$env:SCHOOLBRIDGE_STATIC_DIR = Join-Path $Root "backend/app/static"

$port = 8080
if (-not [string]::IsNullOrWhiteSpace($env:SCHOOLBRIDGE_PORT)) {
    $parsedPort = 0
    if (-not [int]::TryParse($env:SCHOOLBRIDGE_PORT, [ref]$parsedPort)) {
        throw "Configured port is not a valid integer."
    }
    $port = $parsedPort
}

if ($port -lt 1024 -or $port -gt 65535) {
    throw "Configured port is invalid."
}

Set-Location $Root
Write-Host "Starting SchoolBridge at http://127.0.0.1:$port"
& $Python -m uvicorn app.main:app --host 127.0.0.1 --port $port
if ($LASTEXITCODE -ne 0) {
    throw "SchoolBridge stopped with exit code $LASTEXITCODE."
}
