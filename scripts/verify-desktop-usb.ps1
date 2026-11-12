$ErrorActionPreference = "Stop"
$PackageDir = [IO.Path]::GetFullPath($PSScriptRoot)
$Manifest = Join-Path $PackageDir "SHA256SUMS.txt"
if (-not (Test-Path $Manifest -PathType Leaf)) { throw "USB integrity manifest is missing." }

$rootPrefix = $PackageDir.TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
$listed = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
foreach ($entry in Get-Content -LiteralPath $Manifest) {
    if ([string]::IsNullOrWhiteSpace($entry)) { continue }
    if ($entry -notmatch '^([A-Fa-f0-9]{64})  (.+)$') { throw "Invalid SHA-256 manifest entry." }
    $expectedHash = $Matches[1].ToUpperInvariant()
    $relativePath = $Matches[2]
    if ([IO.Path]::IsPathRooted($relativePath)) { throw "Absolute paths are not allowed in the USB manifest." }
    $filePath = [IO.Path]::GetFullPath((Join-Path $PackageDir $relativePath))
    if (-not $filePath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe path in USB manifest: $relativePath"
    }
    if (-not $listed.Add($relativePath)) { throw "Duplicate USB manifest entry: $relativePath" }
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { throw "USB package file is missing: $relativePath" }
    $actualHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($actualHash -ne $expectedHash) { throw "USB package integrity check failed: $relativePath" }
}

$actualFiles = @(Get-ChildItem -LiteralPath $PackageDir -File -Recurse | Where-Object { $_.FullName -ne $Manifest })
foreach ($file in $actualFiles) {
    $relative = $file.FullName.Substring($rootPrefix.Length)
    if (-not $listed.Contains($relative)) { throw "Unmanifested file found in USB package: $relative" }
}
if ($listed.Count -ne $actualFiles.Count) { throw "USB manifest contains entries that do not match the package file count." }

$installer = Join-Path $PackageDir "SchoolBridge-Setup.exe"
if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) { throw "SchoolBridge desktop installer is missing." }
if ((Get-Item -LiteralPath $installer).Length -lt 100MB) {
    throw "Installer is unexpectedly small; confirm the offline WebView2 runtime is bundled."
}
Write-Host "USB package integrity verified. SchoolBridge offline desktop installer is present." -ForegroundColor Green
