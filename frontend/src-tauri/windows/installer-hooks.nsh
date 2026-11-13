!include "LogicLib.nsh"
!include "x64.nsh"

!macro NSIS_HOOK_PREINSTALL
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP|MB_OK "SchoolBridge requires 64-bit Windows. No files have been installed."
    Abort
  ${EndIf}

  ReadRegStr $0 HKLM "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" "ProductName"
  ReadRegStr $1 HKLM "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" "CurrentBuildNumber"
  ReadRegStr $3 HKLM "SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" "EditionID"
  StrCpy $2 $0 10

  ${If} $2 == "Windows 10"
    StrCpy $4 "0"
    ${If} $1 >= 16299
      StrCpy $4 "1"
    ${ElseIf} $3 == "EnterpriseS"
      ; Microsoft lists Windows 10 Enterprise 2015/2016 LTSB as WebView2-supported exceptions.
      ${If} $1 == 10240
        StrCpy $4 "1"
      ${ElseIf} $1 == 14393
        StrCpy $4 "1"
      ${EndIf}
    ${EndIf}
    ${If} $4 != "1"
      MessageBox MB_ICONSTOP|MB_OK "SchoolBridge requires Windows 10 version 1709 (build 16299) or newer, except supported Enterprise 2015/2016 LTSB editions. No files have been installed."
      Abort
    ${EndIf}
  ${ElseIf} $2 == "Windows 11"
    ${If} $1 < 22000
      MessageBox MB_ICONSTOP|MB_OK "SchoolBridge requires Windows 11 version 21H2 (build 22000) or newer. No files have been installed."
      Abort
    ${EndIf}
  ${Else}
    MessageBox MB_ICONSTOP|MB_OK "This SchoolBridge desktop package supports 64-bit Windows 10 version 1709 or newer (plus Enterprise 2015/2016 LTSB), and Windows 11. No files have been installed."
    Abort
  ${EndIf}
!macroend
