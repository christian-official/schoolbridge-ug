# SchoolBridge school-readiness and first installation guide

This guide describes the current local-network deployment foundation. A school runs SchoolBridge on one designated host computer/server; staff computers, phones and tablets use a browser over the school's trusted local network. Client devices do not connect directly to PostgreSQL.

> **Release warning:** use only a reviewed, tested SchoolBridge release for a real school. The current owner-key changes are on the development branch until they pass CI and are deliberately released. Do not use a development branch or test database for real student records.

## 1. Decide how the school will operate SchoolBridge

For the current school deployment model, choose one computer to be the permanent SchoolBridge host. It stores the database and runs the application services. Other devices connect to it over school Wi-Fi or wired Ethernet.

- A cloud/Render preview is for remote testing and is not the same as the school's local installation.
- A local-network installation can continue serving devices on the school's LAN when the internet connection is unavailable, provided the host, router/switch and local network remain powered and working.
- The current browser service worker caches the application shell only. Do not promise that all school records or all editing functions work offline. Use only the offline features explicitly supported by the current release.
- Do not expose the app or PostgreSQL directly to the public internet.

## 2. School and equipment readiness checklist

### Host computer/server

Recommended planning baseline (not a formally benchmarked minimum):

- A reliable 64-bit Windows 10/11 computer, or a supported Linux host.
- 4 CPU cores or better.
- 8 GB RAM as a practical starting point; 16 GB recommended for a busy school or several simultaneous users.
- SSD storage, with at least 100 GB free to start; allow more for school records, uploaded logos/documents and backups.
- A supported Docker installation: Docker Desktop with WSL 2 on Windows, or Docker Engine and Docker Compose on Linux.
- A dedicated operating-system account for maintenance, protected by a strong password.
- A UPS for the host and network equipment where possible.

These are planning recommendations. Actual capacity depends on user count, data volume, file uploads and how long backups are retained.

### School network

- A reliable router and/or network switch with Wi-Fi coverage in the areas where staff will use the system.
- A reserved/static private LAN IPv4 address for the host, so the SchoolBridge address does not keep changing.
- A firewall rule allowing the SchoolBridge web port (8080 by default) only from the school's trusted LAN.
- Wired Ethernet for the host is preferred; staff devices can use trusted school Wi-Fi.
- Do not publish PostgreSQL's database port or forward the SchoolBridge port from the router to the public internet.
- Decide who is allowed to connect to the school's staff network.

### Power, backup and support

- Stable electricity and a UPS where possible.
- A separate encrypted external drive or secured backup destination for copies of database backups.
- A named school contact responsible for reporting faults and arranging access for maintenance.
- An agreed maintenance window for updates and backup recovery tests.

## 3. Information to collect from the school before installation

Confirm these details with the head teacher or authorised school representative. The official identity fields become protected after first-time setup, so verify spelling and choices before submitting.

### Required by the current first-time setup form

- Official registered school name.
- School type: Primary, Secondary or Combined.
- School structure: Day, Boarding or Both.
- Country (for example, Uganda).
- First administrator username (3–80 characters; letters, numbers, underscore, dot and hyphen).
- First administrator email address.
- First administrator password (at least 12 characters).

### Optional fields currently available in the setup form

- Physical address.
- Official school telephone number.
- School email address.
- School motto.
- School logo: PNG, JPEG or WebP; smaller than 1.4 MB.
- House names, one per line.

### Useful information to prepare for later configuration

The following are not all requested by the current first-time setup form. Collect them for the school's later configuration and onboarding:

- District, town and physical directions.
- School ownership/management category and official registration details, if the school wants them recorded.
- Current academic year and term dates.
- Classes, streams and year groups.
- Subjects and curriculum structure.
- Staff list, staff roles and contact details.
- Student register and admission numbers.
- Fee structures, payment methods and opening balances, if the school will use finance features.
- Parent/guardian contact information and the school's consent/communication procedures.
- Existing records that need importing, with a clear decision about which records are authoritative.

Do not send real student or parent data through chat or place it in a development/test environment. Use the school's approved secure transfer process and test imports with synthetic data first.

## 4. Owner verification: where it is done

Owner verification is performed by **you on your own trusted computer**, using the SchoolBridge owner-license command-line utility in a local copy of the reviewed SchoolBridge release. It is not performed in the school's browser, not in GitHub, and not by entering your private key into Render or the school server.

The school browser only displays a unique installation ID and accepts the signed activation code.

### Before visiting the school

1. On your trusted owner computer, obtain the reviewed SchoolBridge release.
2. Install Python 3 and the utility dependency: `python -m pip install cryptography`.
3. Generate your owner keypair once, following [CHRISTIAN Owner Key provisioning](CHRISTIAN_OWNER_KEY.md).
4. Keep the encrypted private key and its passphrase under your control. Keep a secure offline backup.
5. Copy only the Base64 public key into the school's server-side `.env` as `SCHOOLBRIDGE_LICENSE_PUBLIC_KEY`.
6. Never copy the private key or its passphrase to the school host, GitHub, a shared drive, email or chat.

### At the school, after SchoolBridge starts

1. Open the SchoolBridge address on the host or a device on the school's LAN, for example `http://192.168.1.20:8080`.
2. Copy the **Unique Installation ID** displayed by the first-time setup screen.
3. On your trusted owner computer, run the `sign-license` command with that exact ID and a new unique license ID.
4. Enter your private-key passphrase when prompted. The tool prints a signed code beginning `CHRISTIAN:`.
5. Paste that signed code into the school's SchoolBridge activation page.
6. After activation, paste the same code again when completing the school setup and creating the first administrator.

The activation code is tied to that installation ID. It cannot be used to activate a different installation. Never share the private key or passphrase with school staff.

## 5. Install the local-network services

Follow the current [Local Network Installation guide](LOCAL_NETWORK_INSTALLATION.md). In summary:

1. Copy the reviewed release to the host computer.
2. Create the school's private `.env` file from `.env.example`.
3. Set strong, unique database and application secrets.
4. Add the owner's Base64 public verification key.
5. Set a stable port and confirm the host's LAN address.
6. Start the Docker Compose services with `docker compose up -d --build`.
7. Confirm the database, backend, frontend and backup services are healthy.
8. Open the local SchoolBridge address and perform the owner activation described above.

Do not run `docker compose down -v`; that removes persistent database and backup volumes.

## 6. Complete the school setup

On the first-time setup page:

1. Activate the installation using the signed `CHRISTIAN:` code.
2. Re-enter the same activation code when prompted during school setup.
3. Enter the verified official school name, school type, country and school structure.
4. Enter the optional contact and location details.
5. Add the school logo and house names if ready.
6. Create the first administrator account. The password must be at least 12 characters.
7. Confirm that the official school identity is correct before submitting.
8. Wait for the success message, then sign in with the administrator account.

The first administrator is a school administrator, not the software owner. This account does not receive the owner's private signing key or authority to activate another installation.

## 7. After setup: school handover checklist

- Confirm the school name and identity on the application.
- Sign in as the first administrator and verify access.
- Create individual staff accounts; do not share the first administrator password.
- Configure academic year, terms, classes, streams and subjects.
- Configure school-specific admission numbering and grading where applicable.
- Add staff and students using an approved, checked data source.
- Configure fees and finance only after the school verifies its fee schedule and opening balances.
- Register approved user devices and explain which offline functions are actually supported.
- Confirm the host's reserved LAN address and bookmark the SchoolBridge URL on staff devices.
- Confirm automated backup service status and make a separate encrypted backup copy.
- Perform a test restore to a separate database before relying on the backup process.
- Train the administrator and identify the school's maintenance contact.

## 8. Before the school is declared ready

Do not hand over the system until the host survives a restart, the database persists, authorised staff devices can connect over the LAN, unauthorised external access is blocked, the administrator can sign in, and a backup has been created and its recovery procedure tested.

A school installation is not production-ready merely because the login page opens.