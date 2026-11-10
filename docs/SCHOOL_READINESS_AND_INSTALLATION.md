# SchoolBridge school readiness and first installation

## Agreed architecture

SchoolBridge is local-first. Each school has its own local database, and its frontend/backend run on the school's computer. Render is only a preview/development service. Internet is not required for installation, login or ordinary local school operations.

A school can install and operate on one standalone computer with no internet, router, Wi-Fi or LAN. A local network is optional and is required only if additional devices must connect to the host. Internet may later support optional updates, remote parent access, external notifications or off-site backups; it must not be a dependency for core local operations.

**Honest release status:** the repository contains a local PostgreSQL/Compose stack and USB packaging scripts. The preparation script stages the official Docker Desktop and WSL installers, verifies their signatures, builds and exports the application/database images, and generates a SHA-256 manifest. The school installation workflow uses these staged files without downloading the application images. A clean-machine installation with internet disconnected has not yet passed acceptance testing. The service worker caches the application shell only; complete offline record access and offline writes across all modules are not implemented.

## 1. Prepare the computer

Current project preflight baseline: supported 64-bit Windows 10 22H2 or Windows 11 23H2 or later, at least 8 GB RAM, hardware virtualization enabled, WSL 2.1.5 or later, and a compatible Docker Desktop installation. These are project baselines, not a substitute for checking current vendor requirements and licensing.

On the online preparation computer, run `scripts/prepare-usb.ps1` as described in [USB installation](USB_INSTALLATION.md). It creates the complete package under `dist/SchoolBridge-USB`. Copy that entire folder to a USB drive and verify its SHA-256 manifest after copying.

At the school, run `prepare-school-host.ps1` from an elevated PowerShell window. Complete Docker Desktop's interactive setup and licence acceptance, restart if requested, start Docker Desktop and wait for its engine. Run `check-school-host.ps1` and resolve all blockers before proceeding.

## 2. Information to collect from the school

Confirm with an authorised school representative:

**Required by the current setup form**
- Official school name.
- School type: Primary, Secondary or Combined.
- School structure: Day, Boarding or Both.
- Country.
- First administrator username, email and password (at least 12 characters).

**Optional**
- Physical address, official telephone, school email, motto, logo (PNG/JPEG/WebP under 1.4 MB), and house names.

**Prepare for later configuration**
- Academic year and terms; classes, streams and subjects; staff/student registers; admission numbers; fees and opening balances; parent/guardian contacts and consent procedures.

Do not put real student data in development/test environments or send it through chat. Test imports with synthetic data first.

## 3. Owner verification

Owner verification is performed by the software owner on a trusted computer using the local SchoolBridge owner-license utility. The school browser displays a unique installation ID and accepts the signed activation code. The private signing key and passphrase never go to the school host, GitHub, Render or school staff.

1. Generate the owner keypair once on the trusted owner computer following [CHRISTIAN Owner Key provisioning](CHRISTIAN_OWNER_KEY.md).
2. Keep the encrypted private key and passphrase secure and separate; retain an offline backup.
3. Configure only the Base64 public key in the school's local `.env` as `SCHOOLBRIDGE_LICENSE_PUBLIC_KEY`.
4. At the school, copy the unique installation ID from the first-time setup page.
5. On the trusted owner computer, sign that exact ID. The resulting activation code begins `CHRISTIAN:`.
6. Paste the code into the school's activation page and re-enter it during setup if prompted.

Never share the private key or passphrase.

## 4. Install from USB

Follow [USB preparation and first installation](USB_INSTALLATION.md). The installer verifies the package manifest, checks host readiness, creates local secrets, validates the owner's public verification key, imports the prebuilt images and starts the services after explicit operator confirmation. Copy the package to the school's local disk before running the database; do not run the database from the USB itself.

The intended single-computer workflow needs no LAN or internet once the supported local runtime is ready and all package files are present.

## 5. Optional local network

Only if teachers need to connect from additional devices, provide a local router, hotspot or wired network. The host runs the services and database; client devices use a browser and never connect directly to PostgreSQL. Internet is not required for this local connection.

## 6. First setup and handover

Owner-activate the installation, verify the school's identity, enter contact/structure details and create the first school administrator. This administrator account is separate from the software owner's signing authority.

Before handover, verify login, database persistence after restart, a successful backup and a tested restore. Test required modules with internet disconnected. Do not declare production readiness until clean-machine USB/runtime and offline module acceptance tests pass.
