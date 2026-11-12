# SchoolBridge self-registration and low-connectivity approval design

## Product decision

Parents and teachers must create their own SchoolBridge accounts by matching information they provide against trusted school records. Schools must not have to print, distribute, or repeatedly retrieve usernames, surnames, temporary passwords, or passcodes for ordinary sign-in.

A school must not need to be online at the moment a parent or teacher registers. Routine registration must be decided from school records already synchronised to the hosted platform. School staff approval is an exception path for ambiguous or unverifiable records, not a dependency for every registration.

Admission numbers are optional. They must never be required to identify a student, link a parent, or complete registration.

## Parent journey

1. A parent scans the school's reusable QR code from anywhere with internet access. The QR identifies the school workspace; it is not an authentication credential.
2. The parent confirms the displayed school and chooses **Create parent account**.
3. The parent enters their own details and the details requested to identify their relationship to one or more enrolled children. The form must support schools whose paper records do not contain admission numbers.
4. The platform compares the submitted information only against records belonging to that school.
5. The applicant must not type in, edit, or nominate the phone number used for verification. SchoolBridge retrieves the phone number from the matched, trusted school record and displays only a masked version (for example, `+256 7XX XXX 482`) so the parent can recognise it without exposing the full number.
6. The parent confirms whether they can access that displayed number. SchoolBridge sends a one-time verification code only to that existing recorded number. The applicant cannot substitute a different number during this step.
7. After successful code verification, the parent can create their own password and claim the matched children. If the recorded number is missing, untrusted, inaccessible, or the match is not sufficiently reliable, route the claim to school review instead of allowing the applicant to supply a replacement number.
8. One parent account can link to multiple children at the same school. The process must not create separate accounts for siblings.
9. If the match is ambiguous, the submitted details conflict, or no trusted contact channel exists, create a pending claim for review. Do not guess, expose a list of students, or grant access while pending.
10. Once verified, the parent sees only their linked children and permitted parent features.

## Teacher journey

1. A teacher scans the school's QR code or opens the shared SchoolBridge address and confirms the school.
2. The teacher chooses **Create teacher account** and supplies the requested identity and employment details.
3. The platform matches the submission against an active staff record for that school.
4. A unique match plus verification of a trusted contact channel permits account creation and the role/permissions associated with that staff record.
5. Ambiguous matches, missing trusted contact details, or conflicts enter the pending review path. A teacher must never be able to choose their own role, permissions, classes, or staff identity.

## Low-connectivity approval model

- School administrators enter or import paper records while working in the school's local SchoolBridge installation.
- The local installation stores a durable, auditable queue of approved roster and guardian/staff relationship changes.
- When connectivity is available, the school synchronises those changes to the hosted platform. The school does not need a continuous connection.
- The hosted platform can complete routine registrations against the latest successfully synchronised trusted records; the school does not need to be online at that moment.
- Claims that cannot be safely resolved automatically remain pending. A school administrator can review them in the local installation; the decision synchronises when connectivity returns.
- Pending claims must not grant access before the approval decision reaches the authoritative hosted service.
- The user-facing status must explain that a claim is awaiting school review; it must not imply that the school is currently online.

## Identity matching and safety rules

- Match within an immutable school/workspace boundary; never search across schools.
- Admission number is optional and may be absent, duplicated in source documents, or not used by a school.
- Use the available combination of student identity, guardian identity/relationship, trusted contact details, class/year and other recorded attributes. Do not treat a name-only match as proof.
- A single parent may be linked to multiple students when the trusted records support those relationships.
- Multiple possible matches, conflicting details, or no adequate verification evidence must enter review.
- Never reveal candidate student records to an unauthenticated registrant.
- Apply rate limits, generic failure messages, audit events, and abuse monitoring to registration attempts.
- For parent registration, the verification phone number must come from the matched trusted school record; the applicant must never provide or change it in the verification flow.
- Display only a masked version of the recorded number before verification. Do not reveal the full number to an unauthenticated applicant.
- Ask the parent to confirm access to the displayed number, then send a short-lived, single-use verification code only to that recorded number. Rate-limit code requests and attempts, invalidate used/expired codes, and audit verification events.
- Do not send a verification code to a newly supplied, untrusted number and treat that as proof of identity. If the recorded number is missing, untrusted, or inaccessible, use the asynchronous school-review path; any contact-number correction must be verified and recorded by the school through an authorised process.
- Where no trusted contact channel exists, use the asynchronous school-review path. Do not force schools to invent phone numbers or admission numbers.
- Parent account creation and student linking must be atomic. A failed or pending claim must not leave a partially privileged account.
- Revoke sessions and remove access promptly when a guardian relationship or staff employment record is withdrawn.

## Existing implementation that must be replaced

The current single-school backend still creates parent accounts through an administrator-selected student list and generates a temporary password. Teacher accounts are currently created by an administrator with a username and password. Login still accepts username/password and includes a staff surname/staff-number lookup fallback.

These are legacy flows. They must not be carried into the new public self-registration experience. Keep existing local installations working during migration, but do not enable the new hosted onboarding until tenant isolation, migration/backfill, trusted-record matching, and cross-school tests are complete.

The current `ParentStudentLink` model already supports multiple student links per parent account. Preserve that capability while making each relationship school-scoped and verifiable.

## Implementation sequence

1. **Tenant foundation:** create immutable school identity and safely backfill the existing single-school installation; scope users, students, staff, guardian links, claims, and every school-owned record/query to the tenant.
2. **Trusted identity records:** define explicit guardian relationship/contact records and staff identity records, including source, verification status, and audit history. Keep admission number nullable/optional throughout schemas, imports, validation, and UI.
3. **Offline roster synchronisation:** synchronise approved roster/relationship changes with idempotency, conflict handling, and audit history. Never overwrite a newer hosted decision silently.
4. **Claim workflow:** add parent and teacher registration requests, safe unique-match evaluation, pending review, approve/reject, expiry, rate limits, and atomic account creation.
5. **Authentication:** users choose their own password after successful verification; remove surname-as-login and school-issued temporary credentials from the new flow. Preserve secure password recovery.
6. **Acceptance tests:** cover multiple children per parent, missing admission numbers, duplicate names, absent/untrusted phone numbers, stale offline school data, school offline during registration, delayed approval synchronisation, revoked relationships, and cross-school ID substitution.

## Release gates

Do not expose hosted self-registration until:
- tenant isolation covers every API, relationship, background job, report/export, sync operation, and backup/restore path;
- no registration path can grant access from an ambiguous match;
- parent multi-child linking and optional admission numbers pass backend and frontend tests;
- school approval can be queued and synchronised without requiring the school to be continuously online;
- cross-school isolation and offline/conflict tests pass;
- existing local installations and their data remain safely migratable.

This design does not select a hosting provider and does not change the agreed shared free HTTPS subdomain direction.
