#requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$RuntimeDir = Join-Path $PSScriptRoot "runtime"
$DockerInstaller = Join-Path $RuntimeDir "Docker Desktop Installer.exe"
$WslInstaller = Join-Path $RuntimeDir "wsl.msi"
$restartNeeded = $false
$os = Get-CimInstance Win32_OperatingSystem
$build = [int]$os.BuildNumber
$isWin10 = ($os.Caption -match "Windows 10" -and $build -ge 19045)
$isWin11 = ($os.Caption -match "Windows 11" -and $build -ge 22631)
if (-not ($isWin10 -or $isWin11)) { throw "Supported Windows 10 22H2 or Windows 11 23H2 is required." }
if (-not [Environment]::Is64BitOperatingSystem) { throw "64-bit Windows is required." }
$computer = Get-CimInstance Win32_ComputerSystem
$ramGb = [math]::Round($computer.TotalPhysicalMemory / 1GB, 1)
if ($ramGb -lt 8) { throw "At least 8 GB RAM is required; detected $ramGb GB." }
$processors = @(Get-CimInstance Win32_Processor)
if (@($processors | Where-Object { $_.VirtualizationFirmwareEnabled -eq $true }).Count -eq 0) { throw "Hardware virtualization is disabled. Enable it in BIOS/UEFI and rerun." }
if (-not (Test-Path $DockerInstaller)) { throw "Missing official Docker Desktop Installer.exe in the USB runtime folder." }
Write-Host "Enabling Windows Subsystem for Linux and Virtual Machine Platform..."
foreach ($feature in @("Microsoft-Windows-Subsystem-Linux", "VirtualMachinePlatform")) {
    $state = Get-WindowsOptionalFeature -Online -FeatureName $feature
    if ($state.State -ne "Enabled") {
        $result = Enable-WindowsOptionalFeature -Online -FeatureName $feature -All -NoRestart
        if ($result.RestartNeeded) { $restartNeeded = $true }
    }
}
$wslReady = $false
try {
    $wslOutput = (& wsl.exe --version 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0 -and $wslOutput -match 'WSL version:\s*([0-9]+\.[0-9]+\.[0-9]+(?:\.[0-9]+)?)') { $wslReady = ([version]$Matches[1] -ge [version]"2.1.5") }
} catch { $wslReady = $false }
if (-not $wslReady) {
    if (-not (Test-Path $WslInstaller)) { throw "WSL 2.1.5+ is not ready and the official wsl.msi is missing from the USB runtime folder." }
    Write-Host "Installing the staged Microsoft WSL package..."
    $arguments = '/i "' + $WslInstaller + '" /passive /norestart'
    $wslProcess = Start-Process -FilePath "msiexec.exe" -ArgumentList $arguments -Wait -PassThru
    if ($wslProcess.ExitCode -notin @(0, 3010, 1641)) { throw "WSL installation failed with Windows Installer exit code $($wslProcess.ExitCode)." }
    if ($wslProcess.ExitCode -in @(3010, 1641)) { $restartNeeded = $true }
}

# Docker Desktop defaults to a per-user installation; also support an all-users install.
$dockerCandidates = @(
    (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\Docker Desktop.exe"),
    (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe")
)
$dockerExe = $dockerCandidates | Where-Object { Test-Path $_ -PathType Leaf } | Select-Object -First 1
if (-not $dockerExe) {
    Write-Host "Starting the official Docker Desktop installer."
    Write-Host "Complete its interactive setup and accept its licence terms as the authorised computer operator."
    $dockerProcess = Start-Process -FilePath $DockerInstaller -Wait -PassThru
    if ($dockerProcess.ExitCode -ne 0) { throw "Docker Desktop installer exited with code $($dockerProcess.ExitCode). Complete setup, then rerun this script." }
    $dockerExe = $dockerCandidates | Where-Object { Test-Path $_ -PathType Leaf } | Select-Object -First 1
}
if ($dockerExe) {
    Write-Host "Starting Docker Desktop..."
    Start-Process -FilePath $dockerExe
}
else {
    Write-Warning "Docker Desktop was not found in the standard per-user or all-users install locations. Complete setup, sign in to the installing Windows account, then rerun this script."
}
if ($restartNeeded) { Write-Warning "Restart Windows, open Docker Desktop, wait for its engine, then run check-school-host.ps1." }
else { Write-Host "Runtime preparation finished. Wait for Docker Desktop, then run check-school-host.ps1." }
