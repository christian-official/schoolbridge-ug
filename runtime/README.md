# Optional offline runtime installers

Place official, compatible installers in this folder before running `scripts/prepare-usb.ps1`:

- `Docker Desktop Installer.exe`
- `wsl.msi` (when an offline WSL installation/update package is needed)

The USB preparation script copies this folder into the package. It does not download these installers, and this repository does not redistribute them. Verify integrity, compatibility and licence terms. See [Windows runtime preparation](../docs/WINDOWS_RUNTIME_PREPARATION.md).
