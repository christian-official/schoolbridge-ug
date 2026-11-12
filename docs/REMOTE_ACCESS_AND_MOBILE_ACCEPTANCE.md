# SchoolBridge hosted PWA, universal school access and mobile acceptance

## Hosting decision: one free hosted address for every school

SchoolBridge already has its hosted Render services:

- Frontend/PWA: https://schoolbridge-ug-1.onrender.com
- Backend API: https://schoolbridge-ug.onrender.com

The frontend address is the shared SchoolBridge entry point. Every school must be able to reach the same hosted PWA address. A school must not have to buy a domain, create its own subdomain, configure a tunnel, install a LAN certificate, or be on the school's Wi-Fi just to open the PWA.

The intended onboarding flow is:

1. A school opens the shared SchoolBridge HTTPS address.
2. The school creates or joins its own school workspace through the hosted onboarding flow.
3. SchoolBridge assigns a unique, non-secret school identity within the platform.
4. The school's authorised administrator creates staff/parent accounts and controls access.
5. The administrator generates the school's reusable QR from the shared hosted address. The QR identifies that school workspace; it contains no credentials or invitation secret.
6. Parents and staff scan the QR, confirm the school identity, sign in using their own account, and complete the account-bound device enrolment process.
7. The PWA can be installed from the same shared HTTPS address on Android and iPhone.

There is no per-school domain or subdomain requirement. Schools use the shared platform URL; the school identity is resolved inside SchoolBridge.

## Important implementation and data-safety gate

The current hosted backend still uses a single-school data model and the existing Render configuration points at SQLite. It is not yet safe to onboard unrelated schools into one shared hosted database. Do not solve this by allowing all schools to share one installation, user table or school records.

Before public multi-school onboarding is enabled, implement and test:

- a first-class school/tenant record and immutable tenant identifier;
- tenant ownership on every school-owned record and relationship, including users, students, staff, finance, exams, attendance, settings, files, audit events, devices, invitations, sync journals and backups;
- tenant-scoped authentication and authorisation on every API route, including background jobs, exports, reports, search, sync and backup/restore;
- database constraints and indexes that prevent cross-school references and duplicate identifiers only within the appropriate school;
- school-scoped file/object storage and backup/restore;
- tenant isolation tests that attempt cross-school reads, writes, ID substitution, exports, device pairing and invitation redemption;
- durable hosted database/storage configuration and recovery testing; do not rely on ephemeral application-container SQLite for school records.

The hosted PWA can be developed and tested on the existing Render subdomain while this work proceeds, but public school-data onboarding must remain closed until the tenant-isolation and persistence gates pass. This is a product-readiness gate, not a condition requiring any school to buy a domain or pay for a separate hostname.

## LAN and local-first operation remain supported

The shared hosted PWA does not remove SchoolBridge's local-first deployment option. Schools that install SchoolBridge on their own Windows host can continue using their local database and optional LAN HTTPS listener. See DESKTOP_LAN_ACCESS.md.

The LAN certificate is only needed for that local-network deployment path. It is not a requirement for schools using the shared hosted PWA. Do not make QR generation or PWA installation depend exclusively on a private LAN address.

## QR and invitation security

- The school QR is reusable and does not expire merely because it has been scanned.
- It contains a school/workspace identifier and the shared HTTPS PWA address, never a password, session token or invitation secret.
- Scanning the QR does not sign a person in or grant permissions.
- Staff and parents authenticate with their own accounts.
- Device invitations remain account-bound, single-use and revocable.
- A QR for one school must never allow access to another school's data.
- Every API request must derive and enforce the tenant from the authenticated, verified school context; never trust a tenant ID supplied only by the browser.

## Mobile acceptance checklist

Use test schools, test accounts and synthetic student data only.

### Android (Chrome)

1. Open https://schoolbridge-ug-1.onrender.com from a phone on an ordinary internet connection; no school Wi-Fi, private certificate or custom domain should be required for the hosted PWA.
2. Complete the test-school onboarding flow and confirm the assigned school identity.
3. Generate and scan that school's reusable QR; confirm the correct school is displayed.
4. Confirm a QR for another test school resolves to that other school and cannot expose the first school's records.
5. Sign in with a test parent/staff account and redeem an invitation issued for that exact account.
6. Confirm replay of the same invitation is rejected.
7. Install the PWA from the browser's install/Add to Home Screen prompt and launch it.
8. Verify the update prompt activates a new app shell correctly.
9. Revoke the test device and verify protected device operations are denied.

### iPhone/iPad (Safari)

1. Open the same shared hosted HTTPS address using ordinary internet access; no custom domain, private CA or school LAN should be required.
2. Complete test-school onboarding and verify the school identity.
3. Scan the school's QR, sign in with a test account and redeem its invitation once.
4. Use Share → Add to Home Screen, launch the installed PWA and confirm login/navigation.
5. Repeat the update, invitation replay and device-revocation checks.

### Tenant-isolation acceptance

- Create at least two independent test schools.
- Use similar usernames, admission numbers and record IDs in both schools where supported.
- Attempt cross-school access by changing path IDs, query IDs, request bodies, exports, report filters, sync cursors, invitation identifiers and device identifiers.
- Verify every attempt is denied or returns only data belonging to the authenticated school.
- Verify one school's administrator cannot list, edit, export, revoke or restore another school's data.
- Verify backup and restore operate within one school boundary.
- Verify removing or disabling one school does not affect another school's records.

### Offline and recovery boundaries

- Confirm the PWA shell can reopen while the network is unavailable.
- Confirm protected API requests do not appear to succeed from stale cached responses.
- Do not describe the shell cache as offline access to all school records. API responses and non-GET requests are deliberately not cached.
- Verify synchronisation is tenant-scoped before enabling offline writes across hosted school workspaces.
- Test backup/restore and recovery against the durable hosted database before production onboarding.

Record device model, OS/browser version, test date, school test identifier, installation result, invitation result, update result and revocation result. Never put real student details, passwords or invitation tokens in test reports.

## Completion gate for hosted multi-school PWA

Task 1.10 and hosted multi-school onboarding are not complete until:

- CI passes on the final implementation;
- the shared hosted PWA works from Android and iPhone over ordinary internet access;
- school creation and unique school identity are implemented;
- two or more schools pass tenant-isolation tests across all API and data paths;
- one-time invitation issue, redemption, replay rejection and revocation work end-to-end;
- QR identity verification prevents cross-school access;
- hosted persistence, backup and restore are proven durable;
- PWA updates and current offline-shell boundaries are verified.

No school-specific domain, paid custom hostname, private LAN certificate or tunnel setup is a prerequisite for accessing the shared hosted PWA.
