#requires -RunAsAdministrator
$ErrorActionPreference="Stop"
$PackageDir=$PSScriptRoot
$Target=Join-Path $env:ProgramData "SchoolBridge"
$Manifest=Join-Path $PackageDir "SHA256SUMS.txt"
$PythonZip=Join-Path $PackageDir "python-3.12-embed-amd64.zip"
foreach($required in @($Manifest,$PythonZip,(Join-Path $PackageDir "get-pip.py"),(Join-Path $PackageDir "wheelhouse"),(Join-Path $PackageDir "backend/app/main.py"))){if(-not(Test-Path $required)){throw "Incomplete package; missing $required"}}
$root=[IO.Path]::GetFullPath($PackageDir).TrimEnd([IO.Path]::DirectorySeparatorChar)+[IO.Path]::DirectorySeparatorChar
foreach($entry in Get-Content $Manifest){
 if([string]::IsNullOrWhiteSpace($entry)){continue}
 if($entry.Length -lt 67 -or $entry.Substring(64,2) -ne "  "){throw "Invalid SHA-256 manifest entry."}
 $relative=$entry.Substring(66)
 $path=[IO.Path]::GetFullPath((Join-Path $PackageDir $relative))
 if(-not $path.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw "Unsafe manifest path: $relative"}
 if(-not(Test-Path $path -PathType Leaf)){throw "Package file missing: $relative"}
 if((Get-FileHash $path -Algorithm SHA256).Hash -ne $entry.Substring(0,64)){throw "Package checksum mismatch: $relative"}
}
if(Test-Path $Target){
 if(Test-Path (Join-Path $Target "data/schoolbridge.db")){throw "Existing SchoolBridge database found; installer will not overwrite it."}
 Remove-Item $Target -Recurse -Force
}
$null=New-Item -ItemType Directory -Force -Path $Target
Get-ChildItem $PackageDir -Force | Where-Object {$_.Name -ne "SHA256SUMS.txt"} | ForEach-Object {Copy-Item $_.FullName $Target -Recurse -Force}
$runtime=Join-Path $Target "runtime"
$null=New-Item -ItemType Directory -Force -Path $runtime
Expand-Archive -LiteralPath (Join-Path $Target "python-3.12-embed-amd64.zip") -DestinationPath $runtime -Force
$python=Join-Path $runtime "python.exe"
$pth=Join-Path $runtime "python312._pth"
if(-not(Test-Path $python) -or -not(Test-Path $pth)){throw "Archive is not the expected CPython 3.12 x64 embeddable distribution."}
$pthLines=@(Get-Content $pth | Where-Object {$_ -notmatch '^\s*#?\s*import site\s*$'})
$pthLines += "Lib\site-packages"
$pthLines += "import site"
Set-Content $pth $pthLines -Encoding ASCII
& $python (Join-Path $Target "get-pip.py") --no-index --find-links (Join-Path $Target "wheelhouse")
if($LASTEXITCODE -ne 0){throw "Offline pip bootstrap failed."}
& $python -m pip install --no-index --find-links (Join-Path $Target "wheelhouse") --target (Join-Path $runtime "Lib/site-packages") -r (Join-Path $Target "backend/requirements.txt")
if($LASTEXITCODE -ne 0){throw "Offline backend dependency installation failed."}
$null=New-Item -ItemType Directory -Force -Path (Join-Path $Target "data")
$secretBytes=New-Object byte[] 48
$rng=[Security.Cryptography.RandomNumberGenerator]::Create()
try{$rng.GetBytes($secretBytes)}finally{$rng.Dispose()}
$secret=[Convert]::ToBase64String($secretBytes)
$publicKey=Read-Host "Enter owner's Base64 Ed25519 public verification key"
try{$decoded=[Convert]::FromBase64String($publicKey)}catch{throw "Public key must be valid Base64."}
if($decoded.Length -ne 32){throw "Ed25519 public key must decode to exactly 32 bytes."}
@"
SCHOOLBRIDGE_SECRET_KEY=$secret
SCHOOLBRIDGE_DATABASE_URL=sqlite:///./data/schoolbridge.db
SCHOOLBRIDGE_LICENSE_PUBLIC_KEY=$publicKey
SCHOOLBRIDGE_PORT=8080
"@ | Set-Content (Join-Path $Target ".env") -Encoding ASCII
$shortcutDir=Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs"
$ws=New-Object -ComObject WScript.Shell
$link=$ws.CreateShortcut((Join-Path $shortcutDir "SchoolBridge.lnk"))
$link.TargetPath="powershell.exe"
$link.Arguments='-NoProfile -ExecutionPolicy Bypass -File "'+(Join-Path $Target "run-native-windows.ps1")+'"'
$link.WorkingDirectory=$Target
$link.Save()
Write-Host "SchoolBridge native files installed in $Target. Start from the Start Menu shortcut."
