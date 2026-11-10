# SchoolBridge school readiness and first installation

## Agreed architecture

SchoolBridge is local-first. Each school has its own local database, and its frontend/backend run on the school's computer. Render is only a preview/development service. Internet is not required for installation, login or ordinary local school operations.

A school can install and operate on one standalone computer with no internet, router, Wi-Fi or LAN. A local network is optional and is required only if additional devices must connect to the host. Internet may later support optional updates, remote parent access, external notifications or off-site backups; it must not be a dependency for core operations.

**Honest release status:** the repository has a local PostgreSQL/Compose stack and USB image-packaging scripts. The service worker caches the application shell only; complete offline record access and offline writes across all modules are not implemented. The USB package currently expects a compatible Docker Engine/Compose runtime to be pre-installed; that runtime is not bundled. A clean-machine installation with internet disconnected has not yet passed acceptance testing. Do not call this a finished turnkey offline installer.

## 1. Prepare the computer

Planning baseline only (not formally benchmarked): supported 64-bit Windows 10/11 or Linux, 4 CPU cores, 8 GB RAM (16 GB preferred for larger schools), SSD with at least 100 GB free, reliable power and a separate encrypted backup drive.

The current USB package requires Docker Engine and Compose v2 already installed and running. This is a known packaging gap. A supported offline runtime installer and clean-machine test remain required before the USB installer can be declared complete.

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

Follow [USB preparation and first installation](USB_INSTALLATION.md). The intended single-computer workflow imports prebuilt images locally, configures local secrets and the owner's public key, starts the services, then completes owner activation and school setup. No LAN or internet is required for single-computer operation.

Current limitation: Docker Engine/Compose must already be installed. The USB package does not yet bundle this runtime.

## 5. Optional local network

Only if teachers need to connect from additional devices, provide a local router, hotspot or wired network. The host runs the services and database; client devices use a browser and never connect directly to PostgreSQL. Internet is not required for this local connection.

## 6. First setup and handover

Owner-activate the installation, verify the school's identity, enter contact/structure details and create the first school administrator. This administrator account is separate from the software owner's signing authority.

Before handover, verify login, database persistence after restart, a successful backup and a tested restore. Test required modules with internet disconnected. Do not declare production readiness until clean-machine USB/runtime and offline module acceptance tests pass.
