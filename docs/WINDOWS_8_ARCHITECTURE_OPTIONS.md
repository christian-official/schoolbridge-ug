# Archived research: Windows 8 architecture options

**Research date:** 2026-11-13  
**Status:** ARCHIVED — Windows 8.0 and Windows 8.1 are no longer product targets.

This document preserves the earlier Windows 8-first feasibility research for historical context only. It is not an active roadmap or implementation requirement.

The project has chosen to retain Tauri 2 + React + WebView2 + CPython 3.12 and focus on Windows 10 and Windows 11. The documented minimum technical candidate is Windows 10 version 1709 (build 16299), x64, because Microsoft's WebView2 support documentation lists Windows 10 SAC 1709 and later. Windows 10 versions 1507, 1511 and 1607 remain below that floor.

The earlier wxWidgets native-shell prototype was a minimal compile experiment only. It did not prove a complete SchoolBridge application on Windows 8.0 or 8.1 and is no longer active.

For current decisions, see:
- [Windows compatibility](WINDOWS_COMPATIBILITY.md)
- [Windows desktop runtime feasibility](WINDOWS_DESKTOP_RUNTIME_FEASIBILITY.md)
- [Retired legacy Windows support track](LEGACY_WINDOWS_SUPPORT.md)
