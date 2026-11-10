# SchoolBridge USB preparation and first installation

## Agreed architecture and current status

SchoolBridge is local-first. Each school has its own local database and runs the frontend and backend on its own computer. Render is a preview/development service only. Internet is not required for local installation, login or ordinary school operations. A LAN/router is optional and is needed only when additional devices must connect to the host; one-computer operation requires no network equipment.

**Current implementation status:** the repository has a local PostgreSQL + backend + frontend Compose stack and same-origin Nginx API proxy. The service worker caches the application shell only; it does not provide complete offline record access or offline writes across all modules. The scripts below package application container images so they do not need to be downloaded at the school. They do not yet make a clean Windows computer self-installing: a compatible Docker Engine and Compose v2 runtime must already be installed. Bundling a supported runtime and passing a clean-machine, internet-disconnected acceptance test remain release blockers. This is a USB image-packaging foundation, not a finished turnkey offline installer.

## 1. Prepare the USB package

On a preparation computer with Docker Engine/Desktop, Compose v2, PowerShell and internet for the initial build, run from the repository root:

```powershell
.\scripts\prepare-usb.ps1
```

The script builds the frontend and backend images, pulls the PostgreSQL image on the preparation computer, exports all three images to `dist\SchoolBridge-USB\schoolbridge-images.tar`, and copies the Compose file and school installer. Copy the complete `dist\SchoolBridge-USB` folder to a USB drive formatted as exFAT or NTFS.

Never put the owner's private signing key or passphrase on the USB. Only the public verification key belongs in the school's local `.env`.

## 2. Install on one computer without LAN or internet

1. Confirm that the school computer already has a compatible Docker Engine and Compose v2 installed and running. This runtime is not yet bundled.
2. Copy the USB's `SchoolBridge-USB` folder to a local folder on the computer, such as `C:\SchoolBridge`. Do not run the database from the USB itself.
3. Open PowerShell in that folder and run `./install-schoolbridge.ps1`.
4. The script imports the saved images locally and creates a local `.env` with fresh random database and application secrets.
5. Add the owner's Base64 public key to `SCHOOLBRIDGE_LICENSE_PUBLIC_KEY` in `.env`.
6. Run the installer and choose START. Open `http://localhost:8080` on the same computer.
7. Complete owner activation using the unique installation ID and signed `CHRISTIAN:` code from the trusted owner computer, then complete school setup.
8. Restart the computer and confirm the database records persist.

No router, LAN, Wi-Fi or internet is required for this intended single-computer mode once the runtime is installed.

## 3. Optional multi-device access

If teachers need other devices, connect them to a local Wi-Fi router, hotspot or wired network and open `http://HOST-IP:8080`. Internet is still not required. This optional local connection is not an installation prerequisite.

## 4. Daily operation and backups

- Start: `docker compose up -d`
- Stop: `docker compose down`
- Status: `docker compose ps`
- Backend logs: `docker compose logs -f backend`
- Manual PostgreSQL backup: `docker compose exec backend python backup_postgres.py`

Database and backups use persistent Docker volumes. Never run `docker compose down -v` unless intentionally deleting those volumes. Keep a second encrypted backup on a separate drive and test recovery.

## 5. Production acceptance gate

On a clean supported Windows computer with internet disconnected and no LAN/router, test runtime installation, image import, startup, owner activation, school setup, login, record creation, restart persistence and backup restore. Then test optional local multi-device access. Separately verify offline reading and writing for every required module. Until these tests pass, do not describe the product as a completed offline USB installer.
