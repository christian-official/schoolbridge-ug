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
    ${If} $1 < 16299
      ; Microsoft explicitly lists Windows 10 Enterprise 2015/2016 LTSC
      ; as WebView2-supported exceptions below the 1709 build floor.
      ${If} $3 == "EnterpriseS"
        ${If} $1 == 10240
          ; Windows 10 Enterprise 2015 LTSB
        ${ElseIf} $1 == 14393
          ; Windows 10 Enterprise 2016 LTSB
        ${Else}
          MessageBox MB_ICONSTOP|MB_OK "This Windows 10 build is below the SchoolBridge minimum. Windows 10 version 1709 (build 16299) or newer is required, except supported Enterprise LTSC 2015/2016 editions. No files have been installed."
          Abort
        ${EndIf}
      ${Else}
        MessageBox MB_ICONSTOP|MB_OK "SchoolBridge requires Windows 10 version 1709 (build 16299) or newer. Supported Enterprise LTSC 2015/2016 editions are also accepted. No files have been installed."
        Abort
      ${EndIf}
    ${EndIf}
  ${ElseIf} $2 == "Windows 11"
    ${If} $1 < 22000
      MessageBox MB_ICONSTOP|MB_OK "SchoolBridge requires Windows 11 version 21H2 (build 22000) or newer. No files have been installed."
      Abort
    ${EndIf}
  ${Else}
    MessageBox MB_ICONSTOP|MB_OK "This SchoolBridge desktop package supports 64-bit Windows 10 version 1709 or newer (plus Enterprise LTSC 2015/2016), and Windows 11. No files have been installed."
    Abort
  ${EndIf}
!macroend
