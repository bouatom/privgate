; PrivGate management console — NSIS installer (Windows x64)
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!ifndef PRIVGATE_VERSION
  !define PRIVGATE_VERSION "0.2.0"
!endif

Name "PrivGate Console"
OutFile "PrivGate-Console-Setup.exe"
InstallDir "$PROGRAMFILES64\PrivGate"
InstallDirRegKey HKLM "Software\PrivGate\Console" "InstallDir"
RequestExecutionLevel admin
Unicode True
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_NOAUTOCLOSE
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_TEXT "Open the PrivGate console"
!define MUI_FINISHPAGE_RUN_FUNCTION LaunchConsole
!define MUI_FINISHPAGE_TITLE "PrivGate is installed"
!define MUI_FINISHPAGE_TEXT "Open the console to create the first Master Admin. Other computers reach this host on the management port if you chose all interfaces."

Var Bind
Var WebPort
Var AgentPort
Var Dialog
Var BindAll
Var BindLocal
Var WebPortCtl
Var AgentPortCtl
Var DataDir
Var IsUpgrade

!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipDirOnUpgrade
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom SettingsPage SettingsPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Function InitDataDir
  ReadEnvStr $DataDir ProgramData
  StrCmp $DataDir "" 0 +2
  StrCpy $DataDir "C:\ProgramData"
FunctionEnd

Function .onInit
  StrCpy $Bind "0.0.0.0"
  StrCpy $WebPort "3000"
  StrCpy $AgentPort "3001"
  StrCpy $IsUpgrade "0"
  Call InitDataDir
  ReadRegStr $0 HKLM "Software\PrivGate\Console" "InstallDir"
  ${If} $0 != ""
    StrCpy $INSTDIR $0
  ${EndIf}
  IfFileExists "$DataDir\PrivGate\console.env" 0 +2
    StrCpy $IsUpgrade "1"
  IfFileExists "$INSTDIR\PrivGateConsole.exe" 0 +2
    StrCpy $IsUpgrade "1"
FunctionEnd

Function SkipDirOnUpgrade
  ${If} $IsUpgrade == "1"
    Abort
  ${EndIf}
FunctionEnd

Function SettingsPage
  IfSilent skip_settings
  ${If} $IsUpgrade == "1"
    Goto skip_settings
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "Network" "Choose how this console is reached. Create the Master Admin in the browser on first visit."
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 24u "Other computers can open the management UI when the console binds every interface. Windows brokers use the client port."
  Pop $0

  ${NSD_CreateRadioButton} 0 28u 100% 12u "All network interfaces (recommended)"
  Pop $BindAll
  ${NSD_CreateRadioButton} 0 42u 100% 12u "This computer only (127.0.0.1)"
  Pop $BindLocal
  ${If} $Bind == "127.0.0.1"
    ${NSD_Check} $BindLocal
  ${Else}
    ${NSD_Check} $BindAll
  ${EndIf}

  ${NSD_CreateLabel} 0 62u 90u 12u "Management web port"
  Pop $0
  ${NSD_CreateText} 100u 60u 40u 12u $WebPort
  Pop $WebPortCtl

  ${NSD_CreateLabel} 160u 62u 90u 12u "Client / broker port"
  Pop $0
  ${NSD_CreateText} 250u 60u 40u 12u $AgentPort
  Pop $AgentPortCtl

  nsDialogs::Show
  Return

skip_settings:
FunctionEnd

Function SettingsPageLeave
  ${If} $IsUpgrade == "1"
    Return
  ${EndIf}
  IfSilent skip_leave
  ${NSD_GetState} $BindAll $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $Bind "0.0.0.0"
  ${Else}
    StrCpy $Bind "127.0.0.1"
  ${EndIf}
  ${NSD_GetText} $WebPortCtl $WebPort
  ${NSD_GetText} $AgentPortCtl $AgentPort

  ${If} $WebPort < 1
  ${OrIf} $WebPort > 65535
    MessageBox MB_ICONSTOP "Management web port must be between 1 and 65535."
    Abort
  ${EndIf}
  ${If} $AgentPort < 1
  ${OrIf} $AgentPort > 65535
    MessageBox MB_ICONSTOP "Client port must be between 1 and 65535."
    Abort
  ${EndIf}
skip_leave:
FunctionEnd

Function LaunchConsole
  ExecShell "open" "http://127.0.0.1:$WebPort/setup"
FunctionEnd

Function StopExistingService
  IfFileExists "$INSTDIR\PrivGateConsole.exe" 0 stop_done
  nsExec::ExecToLog '"$INSTDIR\PrivGateConsole.exe" stop'
  Sleep 1500
stop_done:
FunctionEnd

Section "Install"
  Call StopExistingService
  SetOverwrite on
  SetOutPath "$INSTDIR"
  File /r "payload\*.*"

  Call InitDataDir
  CreateDirectory "$DataDir\PrivGate"
  CreateDirectory "$DataDir\PrivGate\logs"

  ${If} $IsUpgrade == "1"
    nsExec::ExecToLog '"$INSTDIR\node.exe" "$INSTDIR\write-env.cjs" --dir "$DataDir\PrivGate" --preserve'
  ${Else}
    FileOpen $0 "$PLUGINSDIR\privgate-setup.ini" w
    FileWrite $0 "bind=$Bind$\r$\n"
    FileWrite $0 "webPort=$WebPort$\r$\n"
    FileWrite $0 "agentPort=$AgentPort$\r$\n"
    FileClose $0
    nsExec::ExecToLog '"$INSTDIR\node.exe" "$INSTDIR\write-env.cjs" --dir "$DataDir\PrivGate" --ini "$PLUGINSDIR\privgate-setup.ini"'
  ${EndIf}

  nsExec::ExecToLog '"$INSTDIR\service-ctl.cmd" start'

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\PrivGate\Console" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrivGateConsole" "DisplayName" "PrivGate Console"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrivGateConsole" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrivGateConsole" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrivGateConsole" "Publisher" "PrivGate"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrivGateConsole" "DisplayVersion" "${PRIVGATE_VERSION}"

  CreateShortCut "$SMPROGRAMS\PrivGate Console.lnk" "http://127.0.0.1:$WebPort/setup"
SectionEnd

Section "Uninstall"
  nsExec::ExecToLog '"$INSTDIR\PrivGateConsole.exe" stop'
  nsExec::ExecToLog '"$INSTDIR\PrivGateConsole.exe" uninstall'
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\PrivGate Console.lnk"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrivGateConsole"
  DeleteRegKey HKLM "Software\PrivGate\Console"
  DeleteRegKey /ifempty HKLM "Software\PrivGate"
SectionEnd
