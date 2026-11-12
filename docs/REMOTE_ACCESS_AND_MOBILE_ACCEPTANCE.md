# SchoolBridge hosted PWA, school QR access and mobile acceptance

## Hosting decision: one shared HTTPS address for every school

SchoolBridge's planned public deployment uses a free hosting provider that supplies a free subdomain and HTTPS. Render is not the selected hosting platform. The exact provider-issued hostname is to be recorded when the hosting account is configured; do not substitute a different provider or publish placeholder URLs.

That one provider-issued HTTPS address is the shared SchoolBridge entry point for every school. A school must not have to buy a domain, obtain its own subdomain, configure a tunnel, install a LAN certificate, or be on the school's Wi-Fi just to open the PWA.

The intended onboarding flow is:

1. A school opens the shared SchoolBridge HTTPS address and establishes its own school workspace.
2. SchoolBridge assigns a unique, non-secret school identity within the platform.
3. The school's authorised administrator enters or imports the school's existing student, guardian and staff records.
4. The administrator generates the school's reusable QR from the shared hosted address. The QR identifies that school workspace; it contains no credentials or invitation secret.
5. A parent or teacher scans the QR. SchoolBridge opens the school's registration page directly, confirms the school identity, and asks for the details required for that role.
6. SchoolBridge automatically matches those details against the selected school's records. A unique valid parent or teacher match creates or resumes the correct account, issues a secure session and opens the appropriate dashboard.
7. Parents and teachers do not need administrator-created accounts, approval, SMS codes, temporary passwords or school-issued passphrases. Only administrators and selected essential non-teaching staff use password accounts.
8. The PWA can be installed from the same shared HTTPS address on Android and iPhone.

There is no per-school domain or subdomain requirement. Schools use the shared platform URL; the school identity is resolved inside SchoolBridge.

## Important implementation and data-safety gate

The backend now has a school/tenant identity foundation and tenant-scoped records, but public multi-school onboarding must remain closed until the full tenant-isolation and hosted-persistence acceptance gates pass. Do not solve this by allowing schools to share users or records.

Before public multi-school onboarding is enabled, verify:

- a first-class school/tenant record and immutable tenant identifier;
- tenant ownership on every school-owned record and relationship, including users, students, staff, finance, exams, attendance, settings, files, audit events, devices, invitations, sync journals and backups;
- tenant-scoped authentication and authorisation on every API route, including background jobs, exports, reports, search, sync and backup/restore;
- database constraints and indexes that prevent cross-school references and duplicate identifiers only within the appropriate school;
- school-scoped file/object storage and backup/restore;
- tenant isolation tests that attempt cross-school reads, writes, ID substitution, exports, device pairing and invitation redemption;
- durable hosted database/storage configuration and recovery testing; do not rely on ephemeral application-container SQLite for school records.

The shared hosted PWA can be developed against the selected free hosting setup while this work proceeds, but public school-data onboarding must remain closed until the tenant-isolation and persistence gates pass. This is a product-readiness gate, not a condition requiring any school to buy a domain or pay for a separate hostname.

## LAN and local-first operation remain supported

The shared hosted PWA does not remove SchoolBridge's local-first deployment option. Schools that install SchoolBridge on their own Windows host can continue using their local database and optional LAN HTTPS listener. See DESKTOP_LAN_ACCESS.md.

The LAN certificate is only needed for that local-network deployment path. It is not a requirement for schools using the shared hosted PWA. Do not make QR generation or PWA installation depend exclusively on a private LAN address.

The standalone Windows desktop backend binds locally and is not reachable by parents at home. The school QR is generated in the hosted web workspace; the QR panel remains hidden in the standalone desktop application. Remote parent access therefore requires the shared hosted service or a separately validated network-accessible server architecture.

## QR and optional device-enrolment security

- The school QR is reusable and does not expire merely because it has been scanned.
- It contains a school/workspace identifier and the shared HTTPS PWA address, never a password, session token or invitation secret.
- Scanning the QR opens the school's registration entry point; it does not by itself sign a person in or grant permissions.
- Parents and teachers must pass server-side matching against records in that exact school before a session is issued.
- A QR for one school must never allow access to another school's data. Restored sessions are checked against the school identity selected by the QR.
- Parent matching checks the parent's recorded name and relationship and each child's identity. A child can be matched by admission number or date of birth; admission numbers are not mandatory where date of birth is available.
- Teacher matching checks the teacher's recorded full name and staff number against one active teaching staff record.
- Ambiguous or invalid details fail closed. They do not create a pending administrator approval request.
- Teachers and parents do not use passwords. Password accounts are reserved for administrators and selected essential non-teaching staff.
- Device invitations remain account-bound, single-use and revocable, but are optional for encrypted offline synchronisation only. They are not required for QR registration or normal online dashboard access.
- Every API request must derive and enforce the tenant from the authenticated, verified school context; never trust a tenant ID supplied only by the browser.

## Mobile acceptance checklist

Use test schools, test accounts and synthetic student data only.

### Android (Chrome)

1. Open the configured shared SchoolBridge HTTPS address from a phone on an ordinary internet connection; no school Wi-Fi, private certificate or paid custom domain should be required.
2. Open a test school's registration workspace and generate its reusable QR.
3. Scan the QR and confirm the correct school registration page opens directly.
4. Complete a parent registration using recorded guardian details and one or more linked children; confirm the parent dashboard opens without SMS, password creation or administrator approval.
5. Complete a teacher registration using the recorded staff number and full name; confirm the teacher dashboard opens without a password.
6. Submit mismatched and ambiguous details and confirm access is denied without exposing student or staff records.
7. Scan a QR for a second test school and verify that the first school's saved session cannot be used to open the second school's dashboard.
8. Install the PWA from the browser's install/Add to Home Screen prompt and launch it.
9. Verify the update prompt activates a new app shell correctly.
10. If testing offline synchronisation, separately issue and redeem an optional device invitation for the already-registered test account; confirm replay is rejected and revocation works.

### iPhone/iPad (Safari)

1. Open the configured shared SchoolBridge HTTPS address using ordinary internet access; no paid custom domain, private CA or school LAN should be required.
2. Scan the test school's QR and verify the registration page identifies the correct school.
3. Complete parent and teacher registration with synthetic school-record details and verify direct dashboard access.
4. Confirm invalid details do not enter an administrator review queue and do not grant access.
5. Use Share → Add to Home Screen, launch the installed PWA and confirm login/navigation.
6. Repeat the school-mismatch and update checks.
7. Test optional device invitation replay and revocation only as a separate offline-synchronisation workflow.

### Tenant-isolation acceptance

- Create at least two independent test schools.
- Use similar usernames, admission numbers and record IDs in both schools where supported.
- Attempt cross-school access by changing path IDs, query IDs, request bodies, exports, report filters, sync cursors, invitation identifiers and device identifiers.
- Verify every attempt is denied or returns only data belonging to the authenticated school.
- Verify one school's administrator cannot list, edit, export, revoke or restore another school's data.
- Verify backup and restore operate within one school boundary.
- Verify removing or disabling one school does not affect another school's records.
- Verify a saved session from one school is cleared when a different school's QR is opened.

### Offline and recovery boundaries

- Confirm the PWA shell can reopen while the network is unavailable.
- Confirm protected API requests do not appear to succeed from stale cached responses.
- Do not describe the shell cache as offline access to all school records. API responses and non-GET requests are deliberately not cached.
- Verify synchronisation is tenant-scoped before enabling offline writes across hosted school workspaces.
- Test backup/restore and recovery against the durable hosted database before production onboarding.
- Treat device enrolment invitations and offline snapshot passphrases as separate offline-synchronisation controls, not as parent/teacher account registration.

Record device model, OS/browser version, test date, school test identifier, registration result, dashboard result, update result and revocation result. Never put real student details, passwords or invitation tokens in test reports.

## Completion gate for hosted multi-school PWA

Hosted multi-school onboarding is not complete until:

- CI passes on the final implementation;
- the shared hosted PWA works from Android and iPhone over ordinary internet access;
- school creation and unique school identity are implemented;
- two or more schools pass tenant-isolation tests across all API and data paths;
- parent and teacher QR self-registration, automatic matching and direct dashboard access work end-to-end without administrator approval or passwords;
- invalid and ambiguous matches fail closed;
- optional device invitation issue, redemption, replay rejection and revocation work for offline synchronisation;
- hosted persistence, backup and restore are proven durable;
- PWA updates and current offline-shell boundaries are verified.

No school-specific domain, paid custom hostname, private LAN certificate or tunnel setup is a prerequisite for accessing the shared hosted PWA.
