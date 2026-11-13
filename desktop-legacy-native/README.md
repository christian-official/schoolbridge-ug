# SchoolBridge legacy native shell spike

This isolated proof of concept explores a native Windows desktop shell for the
Windows 8.0-first requirement. It does not modify or replace the current Tauri app.

## Candidate

- wxWidgets 3.2.x native controls; no embedded browser engine.
- C++11 application entry point.
- Windows API target macros set to Windows 8.0 (0x0602).
- CMake build with wxWidgets 3.2.x installed and discoverable by CMake.

Upstream currently lists Windows 8 among supported platforms and documents
Windows 7 or later for its Windows port:
- https://github.com/wxWidgets/wxWidgets
- https://github.com/wxWidgets/wxWidgets/blob/master/docs/msw/install.md

## Build

Install wxWidgets 3.2.x compiled with the same compiler and architecture, then:

    cmake -S desktop-legacy-native -B build/legacy-native -A x64
    cmake --build build/legacy-native --config Release

CMake must locate wxWidgets. Do not mix compiler ABIs, architectures, or C runtimes.

## What this proves

Only that source is structured as a native wxWidgets application and declares
the Windows 8.0 API baseline. A modern CI compile does not prove launch on Windows 8.0.

## What remains unproven

- Build toolset and CRT compatibility on Windows 8.0 x64.
- Launch, rendering, DPI scaling, input and shutdown on a clean Windows 8.0 machine.
- Windows 8.1, which requires its own test.
- A secure, maintained backend/runtime compatible with Windows 8.0.
- Porting SchoolBridge's React workflows to native UI. This prototype does not
  use an obsolete browser control.
- SQLite migrations, TLS, cryptography, owner activation, offline packaging,
  backup/restore and upgrade lifecycle.

Do not package or distribute this prototype as SchoolBridge. It is not the
production application and contains no school-data functionality.
