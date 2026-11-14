# Native Windows USB installation — deferred

## Current installation method

SchoolBridge is currently delivered as an installable PWA on Windows, Android and supported iOS devices. Windows administrators and essential staff open the school's normal SchoolBridge access link, install the PWA from their browser, and sign in inside the installed app. They do not need a QR scanner.

Parents and teachers use their separate QR codes, install the PWA, and complete verification inside the installed app.

A native Windows USB installer is **not** the current installation method. Task 1.12 USB packaging work is retained as historical engineering work and is deferred until native desktop delivery is explicitly reopened.

## Historical package safety

Older CI runs may contain desktop installer or USB prototype artifacts created with test-only activation credentials. They are not production releases and must never be distributed to schools. Do not use the old Docker/WSL2 prototype as the current SchoolBridge installation path.

## Future native USB release gates

If native desktop delivery is reopened, the USB package must be rebuilt from an approved production installer, include a verified SHA-256 manifest, and pass clean-machine offline installation, activation, persistence, upgrade, repair, uninstall and backup/restore acceptance. Never place private signing keys, passphrases, school administrator passwords or real student records on the USB.

Successful CI packaging alone does not authorize a production release.
