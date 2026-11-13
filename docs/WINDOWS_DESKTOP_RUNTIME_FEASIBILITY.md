# Windows desktop runtime feasibility — Task 1.11 / D1

**Assessment date:** 2026-11-12
**Status:** D1 REOPENED. The existing Tauri 2/WebView2 architecture is rejected for Windows 8.0/8.1, but the product requirement remains active. The next task is to identify and prototype a viable maintained alternative, with Windows 8.0 first. This is an engineering decision record, not a compatibility certification.

## Existing implementation inspected

- The desktop shell is Tauri 2 (frontend/src-tauri/Cargo.toml).
- The Windows renderer is Microsoft Edge WebView2.
- The desktop process starts and supervises the local Python/FastAPI backend.
- The native backend package currently bundles CPython 3.12 and SQLite.
- The existing native Windows installer explicitly accepts Windows 10 22H2, Windows 11 23H2+, and the Windows Server 2022 CI runner; it rejects Windows 8 and 8.1.
- The Tauri bundle is currently disabled in frontend/src-tauri/tauri.conf.json.

## Compatibility findings

| Component | Windows 8.0 | Windows 8.1 | Current supported Windows |
|---|---|---|---|
| CPython 3.12 | Not supported by the CPython Windows support policy | Python 3.12 documentation lists 8.1 and newer | Supported |
| Microsoft WebView2 | No maintained runtime; version 109 was the final release for Windows 8/8.1 | No maintained runtime; version 109 was the final release for Windows 8/8.1 | Supported on documented Windows 10/11 releases |
| Current Tauri 2 + WebView2 shell | Not an acceptable maintained target | Not an acceptable maintained target | Existing implementation path |
| Existing SchoolBridge native installer | Explicitly rejects | Explicitly rejects | Allows Windows 10 22H2 / Windows 11 23H2+ |

Sources checked:
- CPython 3.12 Windows support: https://docs.python.org/3.12/using/windows.html
- Microsoft WebView2 supported Windows versions: https://learn.microsoft.com/en-us/microsoft-edge/webview2
- Microsoft announcement that WebView2 109 was the final release for Windows 8/8.1: https://github.com/MicrosoftEdge/WebView2Announcements/issues/53

## Decision about the CURRENT STACK (not the product objective)

1. Do not ship or certify the current Tauri 2/WebView2 desktop shell on Windows 8 or 8.1. The available WebView2 runtime for those systems is frozen at version 109 and no longer receives security updates. Pinning it would create a known-obsolete browser engine in a school management application.
2. Do not use an end-of-life Python runtime on Windows 8.0 to make the current FastAPI backend appear compatible. Do not weaken TLS, cryptography, password hashing, authentication, or package-integrity checks.
3. Keep Windows 8.0 and 8.1 as explicit product requirements, but mark them blocked / not certified until a genuinely maintained renderer and backend strategy can satisfy the full security and acceptance gates. Do not silently change the minimum OS to Windows 10.
4. Continue the Tauri 2 desktop implementation as a separate supported-Windows engineering target without claiming that it fulfils the Windows 8/8.1 requirement. Preserve the existing Windows 10/11 path and its data.
5. Re-open the legacy runtime decision only with a concrete, maintained alternative and documented evidence for renderer security updates, OS APIs, dependency wheels, TLS, cryptography, x86/x64 coverage, offline packaging and real-machine tests. A self-contained native UI would be a distinct architecture project, not a configuration switch.

## D1 exit result

The current stack has no acceptable maintained desktop-renderer path for Windows 8/8.1. D1 therefore records a no-go for those OS versions with the current Tauri/WebView2 architecture rather than producing a misleading compatibility claim.

## Next engineering work

Proceed with the Tauri desktop package and lifecycle for supported Windows versions while keeping the legacy OS blocker visible. The next implementation gate is to enable a reproducible, offline Tauri bundle that includes the backend runtime and required resources, then verify installation, first launch, local database placement, repair/upgrade safety and uninstall behaviour without touching school data.