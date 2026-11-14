# SchoolBridge release-readiness audit

**Updated:** 2026-11-14  
**Branch:** `feature/student-staff-finance`  
**Current delivery decision:** PWA-first on Windows, Android and supported iOS devices  
**Release status:** **Not approved for production release.**

## Current access decision

SchoolBridge is delivered to Windows users as an installable PWA. Administrators and essential staff open the school's normal access link, install the PWA from their browser, and sign in inside it. Parents and teachers use separate QR routes, install the PWA, and complete their role-specific verification inside the installed app.

No QR scanner is required for Windows staff. A native Windows executable, NSIS installer and desktop USB package are deferred and are not current release deliverables. The earlier Task 1.11–1.13 native packaging work remains historical engineering work; it must not be presented as the current Windows access path.

## Latest verified CI evidence

CI run [#1509](https://github.com/christian-official/schoolbridge-ug/actions/runs/43576766020) completed successfully with all 8 jobs passing on commit `5efe24f6fb2f463ad6fb2443407620e7cde4ee95`. It included frontend lint/tests/build and real-browser PWA tests, backend tests, PostgreSQL recovery integration, Windows-hosted SQLite tests, and native packaging/prototype checks.

That run predates the PWA-first CI workflow adjustment. Its native installer and USB artifacts used CI-only test credentials and are **not production releases**. The revised workflow removes native desktop installer, native package publishing, and Docker/WSL2 prototype packaging jobs. CI for this audit update is pending and must be checked before treating the workflow change as verified.

## Release blockers — remain open

### 1. Production owner activation

The production owner activation public verification key has not been provisioned into a trusted release configuration. CI/test credentials are not production credentials. Keep private signing material secret and out of source control, CI artifacts and school devices.

### 2. Real-device PWA acceptance

Complete and record acceptance on supported Windows browsers, Android devices and iPhones/iPads. Verify:
- Install from the ordinary school access link on Windows without a QR scanner.
- Parent QR and teacher QR remain distinct and route to the correct role.
- Browser landing pages show installation guidance rather than the verification form.
- Verification is completed inside the installed PWA.
- Standalone launch, refresh, sign-out and sign-in preserve or restore the correct school/role context.
- iOS Safari Add to Home Screen and Android installation behaviour.
- Updates, storage behaviour, permissions, display scaling, keyboard navigation, printing and file handling.

Automated browser tests are useful evidence but do not replace physical-device acceptance.

### 3. Offline completeness and data protection

The service worker caches the app shell only; full offline record access and writes across all modules are not complete. The encrypted device snapshot is read-only and time-limited, not a general offline write/synchronisation queue. Database encryption at rest, backup protection, snapshot key management and recovery validation remain separate work.

### 4. Product and regression acceptance

The open product backlog still includes report-template/printing corrections, student lifecycle, staff onboarding, exam publication, gatehouse, timetable, tenant isolation and usability corrections. Resolve and regression-test these in small batches. Complete end-to-end checks against a non-production school database before merge.

## Required release checklist

- [ ] Verify production owner activation configuration without exposing private signing material.
- [ ] Complete physical-device acceptance for Windows PWA, Android PWA and iOS PWA.
- [ ] Verify role-specific parent/teacher QR journeys and staff access without QR.
- [ ] Complete offline module-by-module acceptance and label workflows that require connectivity.
- [ ] Complete data-at-rest, backup/snapshot security and recovery decisions/tests.
- [ ] Resolve and regression-test open product corrections, including tenant and report-print isolation.
- [ ] Review the latest CI evidence and obtain explicit product-owner approval before merging or deploying.

## Release decision

**NO-GO for production release.** The PWA-first access implementation and passing CI are engineering evidence, not production approval. Keep work on the feature branch. Do not merge, deploy, or publish a release without explicit authorization.
