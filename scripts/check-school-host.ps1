$ErrorActionPreference = "Continue"
$issues = New-Object System.Collections.Generic.List[string]
$checks = New-Object System.Collections.Generic.List[object]

function Add-Check([string]$Name, [bool]$Passed, [string]$Detail) {
    $status = "BLOCKED"
    if ($Passed) { $status = "PASS" }
    $checks.Add([pscustomobject]@{ Check = $Name; Status = $status; Detail = $Detail })
    if (-not $Passed) { $issues.Add($Name + ": " + $Detail) }
}

if (-not $IsWindows -and $env:OS -ne "Windows_NT") {
    Write-Error "This host preflight is for Windows 10/11."
    exit 2
}
$os = Get-CimInstance Win32_OperatingSystem
$build = [int]$os.BuildNumber
$isWin10 = ($os.Caption -match "Windows 10" -and $build -ge 19045)
$isWin11 = ($os.Caption -match "Windows 11" -and $build -ge 22631)
$osSupported = ($isWin10 -or $isWin11)
Add-Check "Windows version" $osSupported ($os.Caption + " build " + $build + "; supported baseline is Windows 10 22H2 or Windows 11 23H2 or newer.")
$is64 = [Environment]::Is64BitOperatingSystem
Add-Check "64-bit Windows" $is64 "A 64-bit operating system is required for the current Linux-container package."
$computer = Get-CimInstance Win32_ComputerSystem
$ramGb = [math]::Round($computer.TotalPhysicalMemory / 1GB, 1)
Add-Check "Memory" ($ramGb -ge 8) ("Detected " + $ramGb + " GB; Docker Desktop WSL2 baseline is at least 8 GB.")
$processors = @(Get-CimInstance Win32_Processor)
$virtualization = ($processors.Count -gt 0 -and @($processors | Where-Object { $_.VirtualizationFirmwareEnabled -eq $true }).Count -gt 0)
Add-Check "Hardware virtualization" $virtualization "Enable CPU virtualization in BIOS/UEFI if this check fails."

$wslOutput = ""
$wslVersion = $null
try {
    $wslOutput = (& wsl.exe --version 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0 -and $wslOutput -match 'WSL version:\s*([0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?)') {
        $wslVersion = [version]$Matches[1]
    }
} catch { $wslOutput = "" }
$wslReady = ($null -ne $wslVersion -and $wslVersion -ge [version]"2.1.5")
Add-Check "WSL 2" $wslReady ($(if ($wslVersion) { "Detected WSL " + $wslVersion } else { "WSL 2.1.5 or later is not detected. The WSL offline installer may be required." }))

$dockerCli = [bool](Get-Command docker.exe -ErrorAction SilentlyContinue)
Add-Check "Docker CLI" $dockerCli "Install the Docker Engine runtime before installing the SchoolBridge application images."
$dockerReady = $false
if ($dockerCli) {
    & docker.exe info *> $null
    $dockerReady = ($LASTEXITCODE -eq 0)
}
Add-Check "Docker Engine running" $dockerReady "Start Docker Desktop and wait until its engine is ready."

$checks | Format-Table -AutoSize
if ($issues.Count -gt 0) {
    Write-Host ""
    Write-Host "SchoolBridge host is not ready yet:" -ForegroundColor Yellow
    $issues | ForEach-Object { Write-Host (" - " + $_) }
    exit 1
}
Write-Host "Host checks passed. SchoolBridge can install locally; no internet or LAN is needed for single-computer operation." -ForegroundColor Green
exit 0
