# SchoolBridge QR self-registration and automatic access

## Agreed product decision

Parents and teachers use separate role-specific QR codes. The parent QR opens the parent registration page directly; the teacher QR opens the teacher registration page directly. The plain school webpage is the staff access page: administrators and authorised essential non-teaching staff sign in there and can download the Windows desktop application before signing in. SchoolBridge verifies parent and teacher details against that school's existing records and, when there is one unambiguous match, creates or resumes the appropriate account and opens the correct dashboard automatically.

There is no administrator-initiated parent or teacher account creation, no administrator approval queue, no SMS verification code, and no password creation for parents or teachers. The process is designed for schools whose source records may still be paper-based: the school enters its roster and guardian/staff details into SchoolBridge once; families and teachers then register themselves.

Passwords are reserved for administrator accounts and explicitly selected essential non-teaching staff accounts.

## Public school access webpage

1. The plain school URL opens the school's branded access page.
2. The page offers separate Parent access and Teacher access routes, plus Administrator & essential staff sign-in.
3. The Windows desktop download link is available on this page and on the staff sign-in page. The desktop installer is for administrators and authorised essential non-teaching staff; downloading it does not authenticate a user.
4. Parent and teacher QR codes carry explicit audience values so each opens only its own registration flow. A generic school QR must not make a parent or teacher choose a role manually.

## Parent journey

1. A parent scans the parent-specific school QR code.
2. The QR opens the school's registration page directly and displays the verified school identity.
3. The parent enters their full name and relationship to the child or children.
4. For each child, the parent enters the child's first and last names. Date of birth and class are optional supporting checks; an admission number is never required. A parent can submit up to ten children in one registration.
5. SchoolBridge searches only active student and guardian records belonging to the QR-selected school. The parent's name and relationship must match the recorded guardian information, and each child must resolve to exactly one active student record.
6. If every submitted relationship is verified, SchoolBridge creates or resumes the parent's account, links the verified children, issues a secure session and opens the parent dashboard.
7. The parent does not create a username or password, enter a phone number, wait for a text message, visit the school, or wait for an administrator to approve the registration.

If a child's identity is ambiguous, the student record is not found, or the guardian details do not match, access is denied with a generic correction message. The request is not placed in an administrator review queue and no student record is exposed to the applicant. The school may correct its underlying roster/guardian records through its normal authorised data-entry process; the parent can then retry.

## Teacher journey

1. A teacher scans the teacher-specific school QR code and reaches the teacher registration page directly.
2. The teacher selects **Teacher** and enters their first name, last name and staff number. Position and department can be supplied as additional checks.
3. SchoolBridge matches those details against exactly one active teaching staff record belonging to the selected school.
4. On a unique match, SchoolBridge creates or resumes the teacher account, associates it with the verified staff record, issues a secure session and opens the teacher dashboard.
5. The teacher does not receive a temporary password or need an administrator to create or approve a login.

A teacher profile is entered into the Staff directory without creating a login. The directory generates the staff number, which an administrator can correct later from the staff profile. The school shares the current staff number with the teacher together with the reusable school QR code. The teacher activates access independently by matching those details.

## Password and account rules

- **Administrators:** password-protected accounts.
- **Essential non-teaching staff:** password-protected accounts only when the administrator explicitly selects the account-creation option for that staff profile.
- **Teachers:** QR-verified registration and direct dashboard sessions; no password login or password reset.
- **Parents:** QR-verified registration and direct dashboard sessions; no password login or password reset.
- The Staff directory may create a staff profile without an account. Teaching profiles never receive a password account.
- Parent Access is a directory for reviewing or removing existing parent access. It does not create accounts or approve registrations.
- Device invitations are a separate optional feature for encrypted offline synchronisation. They are not required for QR registration or normal online dashboard access.

## QR identity and school isolation

- The reusable QR contains the shared SchoolBridge web address and the school's public, non-secret identity. It contains no password, session token, student details or invitation secret.
- Scanning the QR is not itself authentication. The submitted parent or teacher details must pass server-side matching before a session is issued.
- The selected school is resolved and verified before registration. Student, guardian, staff and account queries are scoped to that tenant.
- Authenticated sessions report their school identity. If a saved session belongs to a different school than the QR currently being opened, SchoolBridge clears that session rather than showing the wrong school's dashboard.
- The QR code must not be treated as a security boundary or permission grant.

## Verification and abuse controls

- Parent matching uses the child's exact first and last names plus the parent's exact recorded guardian name and relationship. Date of birth and class are optional supporting checks; admission numbers are not required.
- Teacher matching uses the exact recorded first and last names and current staff number, and requires an active teaching staff record.
- Multiple possible student or staff matches fail closed. SchoolBridge never guesses which record to link.
- Matching never searches another school or returns candidate student/staff records to an unauthenticated applicant.
- Registration attempts are rate-limited per school and client connection. Attempt identifiers are HMAC-hashed in the audit log.
- Account creation and parent-child linking occur in one database transaction. Repeating the same verified registration resumes the existing account rather than creating a duplicate for the same identity and child set.
- Existing teacher accounts are resumed by their linked staff record; legacy forced-password-change state is cleared when the teacher successfully activates through QR.
- Parent/teacher password login and password recovery are blocked. Admin password recovery and designated non-teaching staff password management remain available.

## Current implementation status

The following are implemented on the existing feature branch:

1. School QR generation and school identity resolution.
2. QR query routing directly into the parent/teacher registration page.
3. Separate parent and teacher detail forms.
4. Automatic school-scoped matching against student/guardian and active teaching staff records.
5. Direct role-based account creation/resumption and secure dashboard session issuance.
6. Removal of active registration-claim, SMS-verification and administrator-review endpoints and screens.
7. Removal of administrator-created parent accounts and teacher password-account creation.
8. Teacher profile creation without a login; optional password accounts for selected essential non-teaching staff.
9. School-identity checks for restored sessions and rate-limited audit logging.
10. Backend and browser tests for QR registration, invalid matches, repeat registration, school isolation and direct dashboard access.

The latest GitHub Actions run is still queued behind earlier Windows installer jobs. Do not mark this flow accepted until the current backend, frontend/browser, Windows SQLite and deployment CI jobs complete successfully.

## Hosted access and Windows desktop boundary

The public school QR is generated from the hosted HTTPS SchoolBridge web workspace. The standalone Windows desktop backend binds locally and is not reachable by parents at home. The desktop QR panel remains unavailable by design. Remote parent access therefore requires the school's records and account services to be available through the shared hosted HTTPS deployment (or a separately validated network-accessible server architecture).

Task 1.11 (Windows installer) is paused at its existing packaging checkpoint while this QR registration work is completed. Installer activation-key configuration and clean-machine installation/upgrade validation remain separate outstanding work.

## Release acceptance

Do not declare QR onboarding complete until:

- all current CI jobs pass on the final branch commit;
- a parent can scan the QR, match one or more children and land directly in the parent dashboard;
- a teacher can scan the QR, match an active staff record and land directly in the teacher dashboard;
- invalid, ambiguous and cross-school details are rejected without exposing records;
- repeat registration resumes the correct account;
- teacher/parent password sign-in, password recovery, manual administrator creation and administrator approval remain unavailable;
- administrator and selected essential non-teaching password accounts continue to work;
- the end-to-end journey is verified on the hosted HTTPS deployment from an ordinary mobile internet connection.
