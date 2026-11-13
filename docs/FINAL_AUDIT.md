# SchoolBridge release-readiness audit

**Audit snapshot:** 2026-11-13  
**Branch:** `feature/student-staff-finance`  
**Audited commit before this document:** `539245bc65068faf468f28d20d4d8e60156a5b08`  
**Status:** Engineering audit recorded; **not approved for production release**.

This document consolidates the evidence and outstanding gates visible in the repository and CI. It is not a substitute for a full school acceptance exercise, security penetration test, or owner release approval.

## Verified engineering evidence

- CI run [#1348](https://github.com/christian-official/schoolbridge-ug/actions/runs/43337296367) completed successfully with all 8 jobs passing on the audited commit.
- The Tauri/NSIS installer compiles with an early OS/architecture preflight. The current installer rejects 32-bit Windows and Windows 8/8.1; its technical floor is Windows 10 build 19045 or Windows 11 build 22631.
- The CI pipeline builds a standalone offline Windows installer and assembles a USB package with a SHA-256 manifest. A tampered installer is rejected by the USB verifier.
- CI also runs backend tests, native Windows SQLite tests, frontend lint/tests/build, PostgreSQL recovery integration, and a native Windows package install-and-boot check.
- The CI activation key is test-only and randomly generated. The CI artifacts are not production installers.
- The current desktop architecture stores mutable configuration, SQLite data and logs under the user's LocalAppData directory rather than the application installation directory. The desktop backend is designed to bind to loopback by default.
- The legacy Windows runtime feasibility decision explicitly rejects the current Tauri 2/WebView2 stack for Windows 8 and 8.1 rather than pinning an obsolete browser runtime or weakening security.

## Release blockers — must remain open

### 1. Production owner activation key

The production Ed25519 public verification key has not been provisioned into a release build. CI's random test key is not the owner's production key. The private signing key must remain secret and must never be committed, packaged, or shared. No CI artifact may be handed to a school as a production build.

### 2. Clean-machine Windows acceptance

No recorded physical-machine acceptance evidence is present for a currently serviced Windows edition. Before release, record the exact edition, version, build, architecture and WebView2 runtime, then test offline installation, first launch, activation, backend/frontend health, SQLite persistence, restart, display scaling, keyboard use, printing, file dialogs, uploads, repair, upgrade, uninstall and data preservation.

The installer compatibility floor is not a recommendation to deploy an end-of-support Windows release. Check Microsoft's current lifecycle status for the exact edition and servicing channel at release time.

### 3. Windows 8.0 and 8.1 product requirement

Both legacy OS versions remain explicit product requirements. The current desktop stack is a no-go for both because its available WebView2 runtime is obsolete; Windows 8.0 also lacks a currently maintained CPython Windows runtime path for this backend. They remain **blocked / not certified**. A separately engineered maintained renderer/backend strategy and independent acceptance on each OS are required. Do not represent the Windows 10/11 installer as satisfying this requirement.

### 4. Offline completeness and data protection

The service worker caches the app shell only; full offline record access and writes across all modules are not complete. The encrypted device snapshot is read-only and time-limited, not a general offline write/synchronisation queue. The live SQLite database is not encrypted at rest according to the desktop security notes. Database encryption, backup protection, snapshot key management and recovery validation remain separate work.

### 5. Product and regression acceptance

The open product backlog still includes consolidated student lifecycle, staff onboarding, exam publication, report-template/printing, gatehouse, timetable, tenant-isolation and usability corrections. These must be tracked and tested in small batches; this audit does not mark them complete. The development pull request remains a draft and requires the documented end-to-end checks against an existing school database before merge.

## Required release checklist

- [ ] Provision and verify the production public activation key in a trusted release build; keep the private signing key offline.
- [ ] Build a release USB package from the production-key installer and verify its manifest on a separate machine.
- [ ] Complete clean-machine offline install, activation, operation, upgrade, repair, uninstall and backup/restore acceptance on currently serviced Windows hardware.
- [ ] Complete the separate Windows 8.0 and Windows 8.1 architecture and acceptance work before claiming either legacy OS as supported.
- [ ] Complete offline module-by-module acceptance and clearly label workflows that still require a connection.
- [ ] Complete data-at-rest and backup/snapshot security decisions and tests.
- [ ] Resolve and regression-test the open product correction batches, including tenant isolation and per-student report-print isolation.
- [ ] Review the complete test evidence and obtain explicit product-owner approval before merging or deploying.

## Release decision

**NO-GO for production release at this audit snapshot.** The successful CI run is valuable automated evidence, but production-key provisioning, real-machine acceptance, legacy Windows delivery, offline completeness, and other product/security gates remain open. Keep work on the feature branch; do not merge or deploy based on CI success alone.
