# SchoolBridge local deployment foundation

SchoolBridge's agreed installation model is USB-first and local-first. For one computer, the application and database run on that computer and do not require internet, Wi-Fi, router or LAN. For multiple devices, an optional trusted local network lets staff browsers reach the host. Render is only a preview/development service.

Use [USB preparation and first installation](USB_INSTALLATION.md) for the offline image package. This document describes the underlying Docker Compose services and optional LAN mode.

## Current limitations

The Compose stack is a working local service foundation, not a complete clean-machine USB installer. The USB package exports the frontend, backend and PostgreSQL images, but a compatible Docker Engine and Compose v2 runtime must already be installed on the school computer. The runtime is not yet bundled. The service worker caches only the application shell; it does not cache school records or queue offline edits. Complete offline read/write behaviour across all modules and clean-machine acceptance testing remain unfinished. Do not promise full offline operation until those tests pass.

## Services and persistence

The Compose stack runs PostgreSQL, the FastAPI backend, Nginx frontend/API proxy and a separate PostgreSQL backup scheduler. The database and backups use persistent Docker volumes. The browser accesses the backend through same-origin `/api/` routes; it does not need a Render API URL in local Compose mode.

## Optional LAN mode

If multiple devices need access, connect them to the host's trusted local network and open `http://HOST-IP:8080`. The host computer stores the database; clients never connect directly to PostgreSQL. No internet connection is required for this local connection. A LAN is not required for single-computer installation or operation.

Do not expose the application or PostgreSQL directly to the public internet. Restrict the host firewall to the trusted school network. Do not publish the PostgreSQL port.

## Daily operation

- Start: `docker compose up -d`
- Stop: `docker compose down`
- Status: `docker compose ps`
- Backend logs: `docker compose logs -f backend`
- Manual PostgreSQL backup: `docker compose exec backend python backup_postgres.py`

`docker compose down` preserves database and backup volumes. **Never run `docker compose down -v`** unless intentionally deleting both volumes.

The backup service creates a verified PostgreSQL archive immediately and then every 24 hours by default. Keep a second encrypted copy on a separate drive and test recovery. The local backup volume alone does not protect against host loss, theft or disk failure.

PostgreSQL backups must be restored with the PostgreSQL recovery procedure, not the SQLite file restore feature.
