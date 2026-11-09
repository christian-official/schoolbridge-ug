# SchoolBridge — Architecture Notes

## Product target

A Windows-installed school management application for primary and secondary schools, initially targeting Uganda. It must support schools with no internet connection.

## Deployment modes

### 1. Single-computer mode
The Windows computer runs the user interface, local API service and local database. SQLite is suitable for this single-computer mode.

### 2. School LAN mode
A designated school computer runs the API and PostgreSQL database. Staff connect using a browser on phones or computers over the school's Wi-Fi or local hotspot. Internet access is not required for local communication.

### 3. Larger school mode
A dedicated local server runs the API and PostgreSQL database for concurrent users across the school network.

**Important:** SQLite database files must not be shared directly over a network between multiple computers. Multi-user LAN deployments use PostgreSQL through the API.

## Initial technology direction

- Backend: Python + FastAPI
- Data access: SQLAlchemy
- Database: SQLite for single-computer deployments; PostgreSQL for LAN/server deployments
- Frontend: responsive web interface, packaged for Windows desktop use
- Desktop packaging: to be selected after a working application prototype
- Development: GitHub repository + GitHub Codespaces

This is an initial direction, not a final packaging decision. Windows installation, local service startup, network access, upgrades and backup/restore must be tested on real Windows 10/11 machines before release.

## Security requirements

- Separate data and configuration for each school's installation.
- Authentication and role-based permissions.
- Teachers can only access assigned classes and subjects.
- Secure password hashing; never store plain-text passwords.
- Audit important actions such as marks changes, fee edits and user permission changes.
- Validate inputs and protect against common web vulnerabilities.
- Backups must be restorable and exportable.
- Do not use real student or staff personal data in development.

## First milestones

1. Establish the API and automated checks.
2. Design school, user, role, student, class and subject data models.
3. Implement authentication and permissions.
4. Build student and staff administration.
5. Add attendance, examinations, grading and report cards.
6. Add fees, receipts and finance reports.
7. Build the responsive staff interface.
8. Package and test the Windows offline installation.


## Offline synchronisation foundation

The server provides a per-user device registry, an append-only metadata change journal, per-device delivery/checkpoint tracking, and paginated role-scoped bootstrap snapshots for students, classes, attendance, examinations, marks and fee records. Each authenticated account can register a browser or desktop installation, list its registered devices, and revoke a device from future synchronisation. Device identities are scoped to the account that registered them; one user cannot inspect or revoke another user's devices.

This is a synchronisation foundation, not complete offline operation. The browser client does not cache API responses, the change journal is administrator-only, and offline write envelopes are stored as proposals for manual review rather than applied to live records. The server remains authoritative.


### Versioned change journal

The API records append-only change metadata for supported school records (students, classes, subjects, staff, attendance, examinations, marks, fee records, expenses, salaries and timetable entries). Each insert, update or delete receives a monotonically increasing database sequence. Deletes remain represented as tombstones in the journal; the source row is not required to remain present.

The initial change-feed endpoint returns metadata only, paginated by sequence cursor. It does not include student or financial record contents. At this stage, feed access is restricted to administrators with an active registered device. Role-aware record snapshots, per-user/class filtering, idempotent offline writes and conflict resolution remain future work. The journal is not permission to cache or edit records offline.


### Per-device synchronisation checkpoints

Each registered device stores both the highest change-journal sequence returned to it and the highest sequence it has successfully processed. A device may advance its checkpoint only up to its own delivered high-water mark; it cannot acknowledge another device's unseen changes or move its checkpoint backwards. Checkpoints are scoped to the owning account and revoked devices cannot update them. This records progress only; it does not mean record contents have been downloaded or safely applied locally.


### Scoped student bootstrap snapshots

Registered devices can request a paginated, minimal student snapshot. Administrators and staff with explicit Students-view permission receive school-wide student basics; teachers receive only students in classes assigned to them; parents receive only students explicitly linked to their account. Guardian contacts, student contact details, dates of birth and photos are excluded from this first payload. The endpoint is device-owner scoped and rejects revoked devices. Other record types and role-aware change-feed filtering remain disabled until equivalent access rules are implemented and tested.


### Scoped class bootstrap snapshots

Registered devices can request a paginated class catalogue containing only class IDs, names and sections. Administrators and staff with Students-view permission receive the school catalogue; teachers receive only their assigned classes; parents receive only classes containing their linked children. The endpoint uses the same account-owned active-device check as the student snapshot. It does not expose class membership beyond the separately scoped student snapshot.


### Scoped attendance, examination and finance snapshots

Registered devices can now download paginated attendance, exam, marks and fee snapshots. Attendance is limited to administrators, authorised attendance staff, assigned class teachers and parents linked to the affected students. Exam metadata follows class visibility; marks are limited to assigned class/subject pairs for teachers, while parent accounts receive verified results only for linked children. Fee charges and payments are restricted to linked children for parents; authorised finance staff and administrators receive school fee records. The fee snapshot excludes payroll, general expenses and unnecessary payment reference/collector details. Each collection has its own cursor so pagination cannot skip records in another collection. These endpoints are read-only snapshots; they do not enable offline writes or relax the administrator-only change journal.


### Offline proposal submission and conflict review

Offline write envelopes are currently restricted to administrators on active registered devices. Each proposal stores its owner, device identity, idempotency key, entity, operation, base journal sequence, bounded JSON payload and review status. Repeating the same key and content returns the original proposal; reusing a key with different content is rejected.

For updates and deletes, the server checks whether the entity changed after the submitted base sequence. An intervening change marks the proposal as conflicted. An administrator may discard it or rebase it for fresh manual review. **Proposals are not applied to live school records.** Automatic offline writes remain disabled until entity-specific validation, permission-aware application and a complete approval workflow exist. The change feed remains administrator-only because the journal does not yet preserve enough historical relationship context to safely filter deletes and reassignment events for teachers and parents. Proposal submission and review decisions are written to the school audit log with actor, proposal/entity reference, operation or decision, base sequence and resulting status; proposal payload contents are deliberately excluded from audit details. Device revocation is also audited.


### Device revocation and local data limits

Revoking a registered device blocks its future authenticated synchronisation requests. It cannot reach a device that is disconnected or erase information already downloaded to that device. The browser client now revalidates the current account's registered device when the school server reconnects and performs cleanup for that device's local sync-cache namespace if the identity is revoked. The old UUID is retained as revoked and is never silently re-registered.

This is revocation handling, not a complete offline cache. The browser still does not persist API record snapshots, and the service worker continues to cache only the application shell and static same-origin assets. There are therefore no SchoolBridge API record copies in the current browser client to display offline or purge on revocation. Users must not treat exported files, screenshots or other copies outside the application as remotely revocable. General offline record access remains disabled until encrypted local storage, offline re-authentication, role/relationship invalidation and end-to-end cleanup are implemented and tested.


### Browser device registration and revocation controls

Administrators with an active registered device can also review their account's offline proposal queue from Device Management. The review screen displays proposal metadata and the submitted draft payload, and supports discard or rebase. Rebase updates the proposal's comparison baseline and returns it to pending review; it never applies the draft to live records.

The signed-in user can review devices registered to their own account, register the current browser, and revoke an existing device. The browser stores only its account-scoped device UUID; this is an identity marker, not an offline credential or local copy of school records. A revoked identity is not silently reused: the user must explicitly create a replacement identity. Device revocation blocks subsequent sync API requests, but cannot erase information already downloaded to a disconnected device. Offline record storage and editing remain disabled until a permission-aware client and safe application workflow are implemented and tested.
