# Desktop offline operation

## Primary mode: full local school operation

The installed desktop application is designed to keep the core school workflows available without an internet connection. The Tauri frontend talks to its managed backend at `http://127.0.0.1:8080`; the backend binds only to loopback and stores the active SQLite database under:

`%LOCALAPPDATA%\SchoolBridge\data\schoolbridge.sqlite3`

The database is on the computer, not the USB installer. Once the desktop package, bundled Python runtime, configuration, and school installation are present and setup/activation has been completed, routine school records and workflows are served by this local backend and database. Internet connectivity is not required for those local API requests.

School activation is verified locally using the signed Ed25519 activation token. The desktop connection indicator therefore reports whether the **local SchoolBridge service** is ready; it does not claim to measure internet connectivity.

## Recovery mode: local backend unavailable

If the local backend itself cannot be reached, a registered device may use its previously downloaded encrypted offline snapshot. The snapshot:
- is encrypted in browser storage using AES-GCM with a passphrase-derived key;
- is bound to the account, device identity, and SchoolBridge installation ID;
- expires after 24 hours;
- contains only records authorised for that account;
- is read-only and cannot create or modify school records.

After the local service becomes available again, SchoolBridge checks device status, account permissions, and the sync change journal. A revoked device or changed records/permissions causes the saved copy to be cleared and requires fresh authorisation. A revocation issued while a device is offline cannot be enforced until that device reconnects; the encrypted snapshot may remain accessible to someone who knows its passphrase until its 24-hour expiry. This is an explicit limitation of offline access.

## Connectivity-dependent features and boundaries

Email delivery/password recovery and any external integrations naturally require their respective network services. Local network access for other authorised computers and phones is a separate task; the desktop backend remains loopback-only in this phase.

This task does not claim encryption of the live SQLite database at rest, real-machine power-loss testing, Windows 8/8.1 compatibility, or that a read-only recovery snapshot is equivalent to full local operation. Those remain separate validation or security work.
