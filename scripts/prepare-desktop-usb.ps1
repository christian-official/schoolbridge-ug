param(
    [Parameter(Mandatory = $true)]
    [string]$InstallerPath,
    [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $RepoRoot "dist/SchoolBridge-USB"
}

$source = (Resolve-Path -LiteralPath $InstallerPath).Path
if ([IO.Path]::GetExtension($source) -ne ".exe") { throw "InstallerPath must point to the standalone Windows .exe installer." }
$sourceInfo = Get-Item -LiteralPath $source
if ($sourceInfo.Length -lt 100MB) {
    throw "Installer is unexpectedly small; use the offline desktop installer with the bundled WebView2 runtime."
}
$verifySource = Join-Path $PSScriptRoot "verify-desktop-usb.ps1"
$guideSource = Join-Path $RepoRoot "docs/USB_INSTALLATION.md"
foreach ($required in @($verifySource, $guideSource)) {
    if (-not (Test-Path -LiteralPath $required -PathType Leaf)) { throw "Required USB package source is missing: $required" }
}

$target = [IO.Path]::GetFullPath($OutputDirectory)
$repoFull = [IO.Path]::GetFullPath($RepoRoot).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
$targetFull = $target.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
$targetPrefix = $targetFull + [IO.Path]::DirectorySeparatorChar
if ($targetFull.Equals($repoFull, [StringComparison]::OrdinalIgnoreCase) -or
    $repoFull.StartsWith($targetPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "OutputDirectory cannot be the repository root or one of its parent directories."
}
$sourceFull = [IO.Path]::GetFullPath($source)
if ($sourceFull.StartsWith($targetPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "InstallerPath cannot point inside OutputDirectory because that folder is rebuilt from scratch."
}
if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
New-Item -ItemType Directory -Path $target -Force | Out-Null

Copy-Item -LiteralPath $source -Destination (Join-Path $target "SchoolBridge-Setup.exe")
Copy-Item -LiteralPath $verifySource -Destination (Join-Path $target "Verify-USB.ps1")
Copy-Item -LiteralPath $guideSource -Destination (Join-Path $target "USB-INSTALLATION.md")

$manifestPath = Join-Path $target "SHA256SUMS.txt"
$rootPrefix = $target.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
Get-ChildItem -LiteralPath $target -File -Recurse |
    Where-Object { $_.FullName -ne $manifestPath } |
    Sort-Object { $_.FullName } |
    ForEach-Object {
        $hash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToUpperInvariant()
        $relative = $_.FullName.Substring($rootPrefix.Length)
        "$hash  $relative"
    } | Set-Content -LiteralPath $manifestPath -Encoding ASCII

& (Join-Path $target "Verify-USB.ps1")
if ($LASTEXITCODE -ne 0) { throw "USB package self-verification failed." }
Write-Host "USB package created: $target"
Write-Host "Copy the complete folder to a USB drive. Do not copy only the installer."
