; PrivGate management console — NSIS installer (Windows x64)
!include "MUI2.nsh"
!include "x64.nsh"

Name "PrivGate Console"
OutFile "PrivGate-Console-Setup.exe"
InstallDir "$PROGRAMFILES64\PrivGate"
RequestExecutionLevel admin
Unicode True
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File /r "payload\*.*"

  ReadEnvStr $0 ProgramData
  StrCmp $0 "" 0 +2
  StrCpy $0 "C:\ProgramData"
  CreateDirectory "$0\PrivGate"
  CreateDirectory "$0\PrivGate\logs"

  nsExec::ExecToLog '"$INSTDIR\PrivGateConsole.exe" install'
  nsExec::ExecToLog '"$INSTDIR\PrivGateConsole.exe" start'

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrivGateConsole" "DisplayName" "PrivGate Console"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrivGateConsole" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrivGateConsole" "Publisher" "PrivGate"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrivGateConsole" "DisplayVersion" "0.1.0"

  CreateShortCut "$SMPROGRAMS\PrivGate Console.lnk" "http://127.0.0.1:3000/"
SectionEnd

Section "Uninstall"
  nsExec::ExecToLog '"$INSTDIR\PrivGateConsole.exe" stop'
  nsExec::ExecToLog '"$INSTDIR\PrivGateConsole.exe" uninstall'
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\PrivGate Console.lnk"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrivGateConsole"
SectionEnd
