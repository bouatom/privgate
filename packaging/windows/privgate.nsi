; PrivGate management console — NSIS installer (Windows x64)
!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!ifndef PRIVGATE_VERSION
  !define PRIVGATE_VERSION "0.2.1"
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

; Move a file that could not be deleted (still held by a dying process) aside
; instead of failing the copy: Windows refuses to DELETE a running exe but
; permits RENAMING it. The .old-* leftovers are purged on the next run.
!macro MoveAsideIfLocked FILENAME
  ClearErrors
  Delete "$INSTDIR\${FILENAME}"
  ${If} ${FileExists} "$INSTDIR\${FILENAME}"
    StrCpy $R8 0
    ${Do}
      IntOp $R8 $R8 + 1
      ClearErrors
      Rename "$INSTDIR\${FILENAME}" "$INSTDIR\${FILENAME}.old-$R8"
      ${IfNot} ${Errors}
        ${Break}
      ${EndIf}
    ${LoopUntil} $R8 > 8
  ${EndIf}
!macroend

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
    MessageBox MB_ICONSTOP "Management web port must be between 1 and 65535." /SD IDOK
    Abort
  ${EndIf}
  ${If} $AgentPort < 1
  ${OrIf} $AgentPort > 65535
    MessageBox MB_ICONSTOP "Client port must be between 1 and 65535." /SD IDOK
    Abort
  ${EndIf}
skip_leave:
FunctionEnd

Function LaunchConsole
  ExecShell "open" "http://127.0.0.1:$WebPort/setup"
FunctionEnd

; Reads KEY=<digits> from $DataDir\PrivGate\console.env (written by
; write-env.cjs). The network page only runs on first install, so an upgrade
; must recover the live ports this way or firewall rules would drift back to
; the defaults while the service listens elsewhere. Stack in: key name.
; Stack out: validated port text, or empty when absent/unparsable (caller
; then keeps its current value). Round-tripping through IntOp/IntFmt rejects
; quotes, stray CR and anything non-numeric.
Function ReadEnvPort
  Exch $R0
  StrCpy $R1 ""
  ClearErrors
  nsExec::ExecToStack 'cmd /q /c findstr /B /L /C:"$R0=" "$DataDir\PrivGate\console.env"'
  Pop $R2
  Pop $R3
  ${If} $R2 == 0
    StrLen $R4 "$R0="
    StrCpy $R5 $R3 "" $R4
    IntOp $R6 $R5 + 0
    IntFmt $R6 "%u" $R6
    ${If} $R6 == $R5
    ${AndIf} $R6 > 0
    ${AndIf} $R6 < 65536
      StrCpy $R1 $R6
    ${EndIf}
  ${EndIf}
  Exch $R1
FunctionEnd

Function SyncFirewallPorts
  ${If} ${FileExists} "$DataDir\PrivGate\console.env"
    Push "PRIVGATE_WEB_PORT"
    Call ReadEnvPort
    Pop $0
    ${If} $0 != ""
      StrCpy $WebPort $0
    ${EndIf}
    Push "PRIVGATE_AGENT_PORT"
    Call ReadEnvPort
    Pop $0
    ${If} $0 != ""
      StrCpy $AgentPort $0
    ${EndIf}
  ${EndIf}
FunctionEnd

Function StopExistingService
  ; Self-sufficient stop: extract THIS build's control script from the
  ; installer and run it against $INSTDIR. Never trust the on-disk copy -
  ; upgrading a pre-stop-all install means it lacks the stop-all verb
  ; entirely, and fire-and-forget stops leave SERVICE_STOP_PENDING wrappers
  ; locked. The embedded script polls for STOPPED (20s) then escalates to
  ; taskkill /F on the wrapper PID (10s), so no fixed Sleep guess exists.
  ${If} $INSTDIR == ""
    ; Unreachable past the directory page by construction; kept so an empty
    ; target can never reach the helper silently (it would stop/kill nothing
    ; and later show as unrelated locked-file errors).
    MessageBox MB_ICONSTOP \
      "Internal setup error: the installation folder is empty, so the running console cannot be stopped safely. Setup will close instead of touching an unknown folder. Re-run setup and choose an installation folder." /SD IDOK
    Abort
  ${EndIf}
  ${If} $PLUGINSDIR == ""
    MessageBox MB_ICONSTOP \
      "Internal setup error: no temporary plugin folder is available ($TEMP may be unusable), so the service control helper cannot be extracted. Setup will close." /SD IDOK
    Abort
  ${EndIf}
  DetailPrint "Stopping the running console - helper: $PLUGINSDIR\service-ctl.cmd - target dir: $INSTDIR"
  File /oname=$PLUGINSDIR\service-ctl.cmd "payload\service-ctl.cmd"
  ; ExecToStack rather than ExecToLog: the helper's output comes back on the
  ; stack and is quoted verbatim inside the warning below, so a failed stop
  ; shows WHY (stuck status, escalation result) - not just an exit code.
  nsExec::ExecToStack '"$PLUGINSDIR\service-ctl.cmd" stop-all "$INSTDIR"'
  Pop $0
  Pop $1
  ${If} $1 == ""
    StrCpy $1 "(no output captured from service-ctl.cmd)"
  ${EndIf}
  DetailPrint "stop-all finished with code $0"
  ${If} $0 != 0
    ; Locked leftovers would otherwise only surface as confusing "error
    ; writing to file" popups once copying starts.
    ; Silent (/S) Session 0 has no UI. Without a silent default this box
    ; hung the in-console updater forever (prod 10.0.2.25). Abort so the
    ; scheduled-task updater fails closed instead of waiting on a dialog.
    MessageBox MB_ICONEXCLAMATION|MB_OKCANCEL \
      "Stopping the running console failed with code $0. Helper output:$\n$\n$1$\n$\nIf the console is still running, the following file copies may report write errors.$\n$\nContinue anyway? Choosing No aborts the update now." /SD IDCANCEL \
      IDOK stop_warn_continue
    Abort
    stop_warn_continue:
      DetailPrint "Continuing despite stop-all failure - some files may stay locked."
  ${EndIf}
FunctionEnd

Function PrepareLockedTargets
  ; Aside-copies from a previous upgrade are no longer running: purge first,
  ; then move any still-locked hot file out of the way of SetOverwrite.
  Delete "$INSTDIR\*.old-*"
  !insertmacro MoveAsideIfLocked "PrivGateConsole.exe"
  !insertmacro MoveAsideIfLocked "node.exe"
  !insertmacro MoveAsideIfLocked "host.cjs"
FunctionEnd

Section "Install"
  Call StopExistingService
  Call PrepareLockedTargets
  SetOverwrite on
  SetOutPath "$INSTDIR"
  File /r "payload\*.*"

  Call InitDataDir
  ${If} $IsUpgrade != "1"
    RMDir /r "$DataDir\PrivGate"
  ${EndIf}
  CreateDirectory "$DataDir\PrivGate"
  CreateDirectory "$DataDir\PrivGate\logs"

  ${If} $IsUpgrade == "1"
    nsExec::ExecToLog '"$INSTDIR\node.exe" "$INSTDIR\write-env.cjs" --dir "$DataDir\PrivGate" --preserve'
    Pop $0
  ${Else}
    FileOpen $0 "$PLUGINSDIR\privgate-setup.ini" w
    FileWrite $0 "bind=$Bind$\r$\n"
    FileWrite $0 "webPort=$WebPort$\r$\n"
    FileWrite $0 "agentPort=$AgentPort$\r$\n"
    FileClose $0
    nsExec::ExecToLog '"$INSTDIR\node.exe" "$INSTDIR\write-env.cjs" --dir "$DataDir\PrivGate" --ini "$PLUGINSDIR\privgate-setup.ini"'
    Pop $0
  ${EndIf}

  ; Open the management ports in Windows Firewall. Runs after write-env so a
  ; fresh install uses the ports chosen on the network page and an upgrade
  ; reuses the live ports from console.env (SyncFirewallPorts). netsh fails on
  ; hosts without the firewall service (Server Core, hardened images): every
  ; result is logged, none is fatal - remote reachability, not install health.
  Call SyncFirewallPorts
  DetailPrint "Updating Windows Firewall rules (web $WebPort, broker $AgentPort)"
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PrivGate Console (web)"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="PrivGate Console (web)" dir=in action=allow protocol=TCP localport=$WebPort'
  Pop $0
  ${If} $0 != 0
    DetailPrint "WARNING: could not open inbound TCP $WebPort (netsh exit code $0). Other computers may be unable to reach the console until the port is opened manually."
  ${EndIf}
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PrivGate Agent broker"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="PrivGate Agent broker" dir=in action=allow protocol=TCP localport=$AgentPort'
  Pop $0
  ${If} $0 != 0
    DetailPrint "WARNING: could not open inbound TCP $AgentPort (netsh exit code $0). Windows brokers may be unable to connect until the port is opened manually."
  ${EndIf}

  ; The freshly extracted script is current by construction: start (and its
  ; WinSW `install`) updates the existing service in place - same service id,
  ; never a delete/recreate.
  nsExec::ExecToLog '"$INSTDIR\service-ctl.cmd" start'
  Pop $0
  ${If} $0 != 0
    ; Do not fail the whole update over a refused start, but a service left
    ; dead silently is how outages get discovered hours later.
    DetailPrint "WARNING: starting the console service returned code $0. Check the PrivGateConsole service and %PROGRAMDATA%\PrivGate\logs."
  ${EndIf}

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\PrivGate\Console" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrivGateConsole" "DisplayName" "PrivGate Console"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrivGateConsole" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrivGateConsole" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrivGateConsole" "Publisher" "PrivGate"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrivGateConsole" "DisplayVersion" "${PRIVGATE_VERSION}"

  CreateShortCut "$SMPROGRAMS\PrivGate Console.lnk" "http://127.0.0.1:$WebPort/setup"
SectionEnd

Function un.InitDataDir
  ReadEnvStr $DataDir ProgramData
  StrCmp $DataDir "" 0 +2
  StrCpy $DataDir "C:\ProgramData"
FunctionEnd

Section "Uninstall"
  ; Same self-sufficient stop as the install section, so a hand-started node
  ; or a STOP_PENDING drain cannot leave files locked under RMDir /r.
  ${If} $INSTDIR == ""
    MessageBox MB_ICONSTOP \
      "Internal uninstall error: the installation folder is empty, so uninstall cannot tell which folder to remove. Nothing was deleted." /SD IDOK
    Abort
  ${EndIf}
  DetailPrint "Stopping the running console - helper: $PLUGINSDIR\service-ctl.cmd - target dir: $INSTDIR"
  File /oname=$PLUGINSDIR\service-ctl.cmd "payload\service-ctl.cmd"
  nsExec::ExecToStack '"$PLUGINSDIR\service-ctl.cmd" stop-all "$INSTDIR"'
  Pop $0
  Pop $1
  ${If} $0 != 0
    ; Uninstall must stay possible even with a wedged service: report the
    ; failure in the log, keep going, let RMDir /r report leftovers.
    DetailPrint "stop-all returned code $0 during uninstall - continuing. Helper output: $1"
  ${EndIf}
  nsExec::ExecToLog '"$INSTDIR\PrivGateConsole.exe" uninstall'
  Pop $0
  ; Remove the inbound exceptions added at install. Rule names carry no port,
  ; so an upgrade that moved to different ports is still cleaned up.
  DetailPrint "Removing Windows Firewall rules"
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PrivGate Console (web)"'
  Pop $0
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="PrivGate Agent broker"'
  Pop $0
  Call un.InitDataDir
  ; Data survives uninstall on purpose: $DataDir\PrivGate holds privgate.db
  ; plus console.env (DEVICE_SECRET_KEY / TICKET_SIGNING_KEY). Deleting either
  ; file forces every enrolled PC to re-enroll. Remove it by hand only when a
  ; clean slate is really wanted.
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\PrivGate Console.lnk"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\PrivGateConsole"
  DeleteRegKey HKLM "Software\PrivGate\Console"
  DeleteRegKey /ifempty HKLM "Software\PrivGate"
SectionEnd
