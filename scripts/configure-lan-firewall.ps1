param(
    [string]$BindAddress,
    [int]$Port = 8443,
    [string]$InstallDirectory = (Join-Path $env:ProgramData "SchoolBridge"),
    [switch]$Disable
)
#requires -RunAsAdministrator
$ErrorActionPreference = "Stop"
$RuleName = "SchoolBridge LAN HTTPS"
if ($Disable) {
    Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    Write-Host "SchoolBridge LAN firewall access has been removed."
    exit 0
}
if ([string]::IsNullOrWhiteSpace($BindAddress)) { throw "Supply the host's private Wi-Fi IPv4 address with -BindAddress." }
if ($Port -lt 1024 -or $Port -gt 65535 -or $Port -eq 8080) { throw "Use an unprivileged LAN HTTPS TCP port other than 8080." }
$address = $null
if (-not [Net.IPAddress]::TryParse($BindAddress, [ref]$address) -or $address.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw "BindAddress must be a valid IPv4 address." }
$bytes = $address.GetAddressBytes()
$isPrivate = ($bytes[0] -eq 10) -or ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
if (-not $isPrivate -or [Net.IPAddress]::IsLoopback($address) -or $address.Equals([Net.IPAddress]::Any)) { throw "LAN access may be opened only for a private, non-loopback IPv4 address." }
$python = Join-Path ([IO.Path]::GetFullPath($InstallDirectory)) "runtime\python.exe"
if (-not (Test-Path $python -PathType Leaf)) { throw "Installed SchoolBridge Python runtime not found: $python" }
$localAddress = Get-NetIPAddress -AddressFamily IPv4 -IPAddress $BindAddress -ErrorAction Stop
$profile = Get-NetConnectionProfile -InterfaceIndex $localAddress.InterfaceIndex -ErrorAction Stop
if ($profile.NetworkCategory -ne "Private") { throw "The selected network is not classified as Private. Change it through Windows network settings before enabling LAN access." }
$privateFirewall = Get-NetFirewallProfile -Profile Private
if (@($privateFirewall | Where-Object { -not $_.Enabled }).Count -gt 0) { throw "Windows Firewall must be enabled for the Private profile." }
Get-NetFirewallRule -DisplayName $RuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
$rule = @{
    DisplayName = $RuleName
    Group = "SchoolBridge"
    Description = "Allow SchoolBridge HTTPS from the local school subnet only."
    Direction = "Inbound"
    Action = "Allow"
    Enabled = "True"
    Profile = "Private"
    Program = $python
    Protocol = "TCP"
    LocalAddress = $BindAddress
    LocalPort = $Port
    RemoteAddress = "LocalSubnet"
    EdgeTraversalPolicy = "Block"
}
New-NetFirewallRule @rule | Out-Null
Write-Host ("SchoolBridge LAN firewall rule enabled for https://{0}:{1} from the local subnet only." -f $BindAddress, $Port)
Write-Host "To disable LAN firewall access, rerun this script with -Disable."
