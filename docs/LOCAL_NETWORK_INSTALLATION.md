# SchoolBridge local-network installation (preview foundation)

This setup runs SchoolBridge on one school computer/server. Staff devices on the
same trusted school Wi-Fi or wired LAN open the application in a browser. The
backend and PostgreSQL database stay on the host; client devices do not connect
directly to the database.

## Requirements

- A Windows, Linux, or macOS host with Docker Desktop / Docker Engine and the
  Docker Compose plugin.
- A reliable local network and a reserved/static LAN address for the host.
- Enough disk space for the PostgreSQL data and backup volumes.
- A firewall rule allowing inbound TCP on the chosen SchoolBridge port
  (8080 by default) from the school's trusted LAN only.

Do not expose the application or PostgreSQL port directly to the public
internet. The database port is not published by this Compose configuration.

## First installation

1. Copy the repository to the school host and open a terminal in its root.
2. Copy `.env.example` to `.env`.
3. Generate and set two different secrets. OpenSSL examples:

   ```sh
   openssl rand -hex 24
   openssl rand -hex 32
   ```

   Use one output for `POSTGRES_PASSWORD` and the other for
   `SCHOOLBRIDGE_SECRET_KEY`. Hex values avoid URL-encoding problems in the
   PostgreSQL connection string. Do not commit or share `.env`.
4. If port 8080 is already in use, change `SCHOOLBRIDGE_PORT` in `.env`.
5. Start the services:

   ```sh
   docker compose up -d --build
   ```

6. Wait until the frontend and backend containers are healthy:

   ```sh
   docker compose ps
   docker compose logs --tail=100 backend
   ```

7. Create the first administrator interactively:

   ```sh
   docker compose exec backend python create_admin.py
   ```

8. Find the host's LAN IPv4 address and open
   `http://HOST-LAN-IP:8080` on the host and on an authorised device connected
   to the same LAN. Sign in with the administrator account you created.

The Compose setup disables demo-data seeding and uses PostgreSQL with a
persistent database volume. It does not use SQLite over a network share.

## Daily operation

- Start: `docker compose up -d`
- Stop: `docker compose down`
- View service status: `docker compose ps`
- View backend logs: `docker compose logs -f backend`
- Update after backing up: pull the reviewed application version, then run
  `docker compose up -d --build`.

`docker compose down` preserves the database and backup volumes. **Do not run
`docker compose down -v`** unless you intentionally want to delete both
volumes.

## PostgreSQL backups

The backend includes a verified custom-format PostgreSQL backup command. Run
it from the repository host:

```sh
docker compose exec backend python backup_postgres.py
```

The command uses PostgreSQL's `pg_dump`, validates the archive with
`pg_restore --list`, and only then publishes the backup. Files are stored in
the persistent `schoolbridge-backups` Docker volume, with permissions limited
to the container owner. By default, backups older than 30 days are pruned;
change `SCHOOLBRIDGE_BACKUP_RETENTION_DAYS` in `.env` to adjust the window.
A failed dump or validation leaves no published backup.

Run this command regularly using the host operating system's task scheduler
or a trusted scheduler. For example, schedule it daily during a quiet period.
The command is not automatically scheduled by Docker Compose.

To list backups:

```sh
docker compose exec backend sh -c 'ls -lh /backups'
```

The backup volume is on the same host, so it is not protection against host
loss, theft, disk failure, or ransomware. Periodically copy backups to a
separate encrypted drive or secured backup destination, and test recovery
procedures before relying on them. Do not store backup copies in the source
repository.

A PostgreSQL restore is an administrative recovery operation and must be
planned separately. Do not try to use the SQLite file restore feature for
PostgreSQL backups.

## Network and security notes

- Give the host a reserved/static LAN IP so staff bookmarks remain stable.
- Restrict the host firewall to the school's trusted private network.
- Use individual staff accounts and the SchoolBridge permission controls.
- Do not share administrator credentials.
- Keep the host physically secure and protected by a strong operating-system
  login.
- The default CORS value is convenient for a same-origin LAN deployment. For a
  stricter setup, set `SCHOOLBRIDGE_CORS_ORIGINS` to the exact origin used by
  staff browsers, such as `http://192.168.1.20:8080`, then recreate the backend.
- This setup is a LAN deployment foundation, not a hardened public-internet
  deployment. HTTPS, managed firewall policy, tested disaster recovery, and
  production monitoring still need to be configured.
- The browser service worker caches the application shell only. It does not
  cache school records or queue offline edits. If the server is unavailable,
  staff cannot view or change live records until connectivity returns.
- Back up PostgreSQL using PostgreSQL-native backup procedures. The SQLite
  file backup and restore endpoints do not apply to this PostgreSQL deployment.

## SQLite backup note

The SQLite migration snapshots and file restore protections apply only to
single-host SQLite installations. Multi-device network deployments use the
PostgreSQL backup command above.


## Automated backups

The Docker Compose deployment runs a separate backup service that creates a verified PostgreSQL backup immediately and repeats every 24 hours. Archives are stored in the persistent schoolbridge-backups volume and retained for 30 days by default. Set SCHOOLBRIDGE_BACKUP_INTERVAL_HOURS and SCHOOLBRIDGE_BACKUP_RETENTION_DAYS in the deployment environment to change the schedule and retention period.

For a single-computer SQLite installation, configure Windows Task Scheduler to run python backup_scheduler.py --once daily from the backend directory. Keep the backup directory on a separate protected drive where possible, and periodically test restoring a backup before relying on it.


## Encrypted offline record snapshots

An authorised user can explicitly download a short-lived read-only copy from Device Management. The copy is AES-GCM encrypted in browser IndexedDB, isolated by account and registered device, protected by a user-supplied passphrase, and expires after 24 hours. Reconnection checks the current permission fingerprint and scoped change feed; detected changes invalidate the copy. This is a limited snapshot viewer, not a complete offline application session. A disconnected device cannot be remotely wiped.


### PostgreSQL restore procedure

To test or recover a PostgreSQL backup without overwriting the active school database, run `python restore_postgres.py <archive.dump> <new_database_name>` inside the backend environment with the database connection environment configured. The target name must be a new PostgreSQL identifier. The script validates the archive, restores into the new database, verifies the required SchoolBridge tables and drops the new database if validation fails. Inspect the restored instance before changing the deployment connection string. Never restore directly over the active database.
