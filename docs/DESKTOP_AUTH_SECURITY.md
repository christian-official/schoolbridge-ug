# Desktop authentication and credential security

## Server-side session revocation

Access tokens carry a per-account session version checked against the database on protected requests. Signing out, changing a password, or recovering a password increments that version and invalidates previously issued tokens. Migration 0027 adds the version field with a zero default and safely skips legacy setup-only databases that do not yet have a users table.

The desktop attempts server-side revocation during sign-out and clears its local credential. If the computer is offline, the server cannot be notified at that moment; the local credential is still cleared, and the account's server-side token version is unchanged until a later authenticated revocation can reach the server.

## Windows desktop credential storage

The Windows desktop build stores its login access token through the Windows Credential Manager using the `keyring` Windows-native provider. The frontend calls the Tauri commands `store_auth_token`, `load_auth_token`, and `clear_auth_token`; it does not persist the desktop token in browser storage. Browser development builds retain the existing sessionStorage fallback for `sb_token`.

Credential commands reject empty or oversized tokens and fail closed if the Windows credential service is unavailable. Non-Windows desktop builds return an explicit unsupported-storage error rather than falling back to unprotected persistence.

## Scope and remaining security work

This protects the desktop login token using the operating system credential store. It does **not** encrypt the SQLite database, offline snapshots, or other school data at rest. It does not by itself protect a Windows account that is already compromised or unlocked by an unauthorised person.

Local database encryption, offline snapshot key management, backup protection, and recovery validation remain separate security tasks. A successful CI build and test run is not a substitute for a real Windows-machine credential-store and account-isolation test.


## Desktop offline workspace connectivity

The registered-device and encrypted-offline-copy workspace uses the same
loopback backend address as the main desktop application
(`http://127.0.0.1:8080`). It must not issue relative API requests against
the Tauri WebView origin. Browser and hosted builds continue to use their
configured API base URL. The encrypted offline snapshot remains a separate,
read-only cached workspace; this routing correction does not make it a
write-capable offline synchronisation queue.
