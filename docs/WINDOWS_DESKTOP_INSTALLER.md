# Native Windows desktop installer — deferred

## Current product decision

SchoolBridge uses an installable Progressive Web App (PWA) on Windows for now. Administrators and essential staff open the school's normal SchoolBridge access link in a supported browser, install the PWA, and sign in inside the installed app. They do not need a QR scanner.

Parents and teachers continue to use their separate QR routes and complete verification inside the installed PWA.

A native Windows executable and NSIS installer are **not** the current delivery path. Task 1.11 desktop packaging work is retained for possible future use but is deferred until the product owner explicitly reopens native desktop delivery.

## Historical engineering work

The repository contains Tauri packaging configuration, an offline CPython/FastAPI bundle, WebView2 installer staging, installer preflight checks and lifecycle tests. Earlier CI runs compiled these artifacts using CI-only activation test credentials. Those artifacts are test outputs, not production installers, and must not be distributed to schools.

Windows compatibility checks for that native installer do not define PWA browser compatibility. Validate supported Windows/browser combinations through the PWA acceptance plan instead.

## Reopening native desktop delivery

Before restarting this work, obtain an explicit product decision and then review:
- Supported Windows editions and maintained browser/runtime requirements.
- Production activation-key provisioning and secure signing process.
- Clean-machine offline install, upgrade, repair and uninstall behaviour.
- Database/configuration preservation and backup/restore.
- Real-device acceptance and security review.

Do not merge, publish, or deploy a native installer based only on successful CI packaging.
