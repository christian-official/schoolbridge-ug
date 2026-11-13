# Legacy Windows support — retired

**Decision date:** 2026-11-13  
**Status:** Windows 8.0 and Windows 8.1 are no longer SchoolBridge desktop targets.

The Windows 8-first native rewrite has been stopped in favour of broad compatibility with the existing Tauri 2 + React + WebView2 + CPython 3.12 architecture.

## Current desktop target

- Windows 10 version 1709 (build 16299) or newer, x64 — documented minimum technical candidate.
- Windows 11 version 21H2 (build 22000) or newer, x64 — initial build floor.
- Windows 10 versions 1507, 1511 and 1607 remain below Microsoft's documented WebView2 support floor.
- Windows 8.0 and 8.1 are retired and rejected.

The minimum technical candidate is not a security recommendation. Windows 10 1709 is out of normal OS support. Prefer a currently serviced Windows 11 release and verify the exact lifecycle of any Windows 10 edition before deployment.

See [Windows compatibility](WINDOWS_COMPATIBILITY.md) and [Windows desktop runtime feasibility](WINDOWS_DESKTOP_RUNTIME_FEASIBILITY.md) for active requirements and acceptance tests.

## Retired work

The experimental wxWidgets native shell and its dedicated compile-only workflow have been removed from the active branch. They were a minimal window prototype, not the SchoolBridge application, and did not prove Windows 8 runtime compatibility.

No production UI migration, backend rewrite, merge to main or deployment is authorized by this decision.
