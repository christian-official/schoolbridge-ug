# SchoolBridge USB installation package — Task 1.12

## Purpose and release boundary

The USB is a delivery medium for the **standalone SchoolBridge Windows desktop installer** from Task 1.11. It is not a Docker/WSL2 deployment and must not require a separate browser, Docker Desktop, WSL2, internet access, or a school network.

The USB package contains:
- `SchoolBridge-Setup.exe`: the standalone NSIS desktop installer, including the packaged backend/runtime and offline WebView2 installer;
- `Verify-USB.ps1`: checks every packaged file against the SHA-256 manifest and rejects missing, modified, duplicate, unsafe-path or unmanifested files;
- `SHA256SUMS.txt`: file-integrity manifest;
- this installation guide.

The older Docker/WSL2 package remains a prototype only. Do not use `scripts/prepare-usb.ps1` as the Task 1.12 release path.

## Prepare the USB package

Build the standalone installer using the Task 1.11 desktop build process on a trusted preparation computer. Then, from the repository root, run:

```powershell
$installer = Get-ChildItem ".\frontend\src-tauri\target\release\bundle\nsis" -Filter "*.exe" | Select-Object -First 1
.\scripts\prepare-desktop-usb.ps1 -InstallerPath $installer.FullName
```

Replace the example path with the exact installer file produced by the build. The script creates `dist\SchoolBridge-USB`, copies the installer and guide, generates SHA-256 hashes, and runs the verifier against the finished package. It deliberately starts with a clean output folder so stale files cannot conceal an incomplete package.

Copy the **entire** `dist\SchoolBridge-USB` folder to a USB drive formatted as NTFS or exFAT. Keep a protected release copy and do not edit files after generating the manifest.

## Verify the USB at the school

Before installation, open PowerShell in the USB package folder and run:

```powershell
.\Verify-USB.ps1
```

Proceed only when it reports that package integrity is verified. If any file is missing or changed, recreate or recopy the package from the trusted preparation computer.

## Install SchoolBridge

1. Copy `SchoolBridge-Setup.exe` from the USB to a local folder on the school computer. Do not run the application or database from the USB drive.
2. Run the installer and follow its prompts.
3. Launch SchoolBridge from the installed application shortcut.
4. Complete owner activation and first-school setup using the approved school onboarding process.
5. Confirm the school can sign in and that its data is stored on the computer, not on the USB.

The desktop installer is designed to carry its application runtime and offline WebView2 payload. The school computer should not need Docker, WSL2, a separately installed browser, or an internet download for installation.

## Data protection and acceptance

- Never store the owner's private signing key, passphrase, school administrator password, or real student records on the USB.
- The public verification key may be packaged with the application; it does not grant signing authority.
- Keep school data on the host computer and maintain a separate protected backup.
- Test first installation, launch while disconnected from the internet, owner activation, first-school setup, record persistence after restart, upgrade/data preservation, repair, uninstall behaviour, and backup/restore before school handover.
- Do not claim Windows 8 or Windows 8.1 compatibility. Those systems remain blocked pending the separate Task 1.13 compatibility decision and real-device evidence.
- Do not treat a CI-generated test-key installer as a production release. Production owner-key provisioning and release approval remain separate gates.

## Scope boundary

Task 1.12 packages and verifies the standalone installer for USB delivery. It does not certify a Windows version, complete the clean-machine acceptance tests, or replace the remaining Task 1.11 production-key and desktop acceptance gates.
