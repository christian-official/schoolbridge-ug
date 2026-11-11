$ErrorActionPreference="Stop"
$Root=$PSScriptRoot
$Python=Join-Path $Root "runtime/python.exe"
if(-not(Test-Path $Python)){throw "SchoolBridge Python runtime missing."}
if(-not(Test-Path (Join-Path $Root ".env"))){throw "SchoolBridge configuration missing."}
# Load configuration into this process before importing app.database; Python imports
# capture SCHOOLBRIDGE_DATABASE_URL at module load time.
foreach($line in Get-Content (Join-Path $Root ".env")){
 if($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$env:PYTHONPATH=Join-Path $Root "backend"
$env:SCHOOLBRIDGE_STATIC_DIR=Join-Path $Root "backend/app/static"
$port=8080
foreach($line in Get-Content (Join-Path $Root ".env")){if($line -match '^SCHOOLBRIDGE_PORT=(\d+)$'){$port=[int]$Matches[1]}}
if($port -lt 1024 -or $port -gt 65535){throw "Configured port is invalid."}
Set-Location $Root
Write-Host "Starting SchoolBridge at http://127.0.0.1:$port"
& $Python -m uvicorn app.main:app --host 127.0.0.1 --port $port
if($LASTEXITCODE -ne 0){throw "SchoolBridge stopped with exit code $LASTEXITCODE."}
){
  $name=$Matches[1]
  $value=$Matches[2].Trim()
  if(($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))){$value=$value.Substring(1,$value.Length-2)}
  [Environment]::SetEnvironmentVariable($name,$value,"Process")
 }
}
$env:PYTHONPATH=Join-Path $Root "backend"
$env:SCHOOLBRIDGE_STATIC_DIR=Join-Path $Root "backend/app/static"
$port=8080
foreach($line in Get-Content (Join-Path $Root ".env")){if($line -match '^SCHOOLBRIDGE_PORT=(\d+)$'){$port=[int]$Matches[1]}}
if($port -lt 1024 -or $port -gt 65535){throw "Configured port is invalid."}
Set-Location $Root
Write-Host "Starting SchoolBridge at http://127.0.0.1:$port"
& $Python -m uvicorn app.main:app --host 127.0.0.1 --port $port
if($LASTEXITCODE -ne 0){throw "SchoolBridge stopped with exit code $LASTEXITCODE."}
