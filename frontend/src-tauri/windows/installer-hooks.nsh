!include "LogicLib.nsh"
!include "x64.nsh"

!macro NSIS_HOOK_PREINSTALL
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP|MB_OK "SchoolBridge requires 64-bit Windows. No files have been installed."
    Abort
  ${EndIf}

  ReadRegStr $0 HKLM "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" "ProductName"
  ReadRegStr $1 HKLM "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" "CurrentBuildNumber"
  StrCpy $2 $0 10

  ${If} $2 == "Windows 10"
    ${If} $1 < 19045
      MessageBox MB_ICONSTOP|MB_OK "This SchoolBridge desktop package requires Windows 10 version 22H2 (build 19045) or newer. No files have been installed."
      Abort
    ${EndIf}
  ${ElseIf} $2 == "Windows 11"
    ${If} $1 < 22631
      MessageBox MB_ICONSTOP|MB_OK "This SchoolBridge desktop package requires Windows 11 version 23H2 (build 22631) or newer. No files have been installed."
      Abort
    ${EndIf}
  ${Else}
    MessageBox MB_ICONSTOP|MB_OK "This SchoolBridge desktop package does not support this Windows version. Windows 8 and 8.1 are not certified by the current Tauri/WebView2 runtime."
    Abort
  ${EndIf}
!macroend
