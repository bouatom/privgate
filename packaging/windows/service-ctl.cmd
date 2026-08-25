@echo off
setlocal EnableExtensions
if not defined ProgramData set ProgramData=C:\ProgramData

rem Usage: %~nx0 {start^|stop^|stop-all} [target-dir]
rem [target-dir] lets an installer/updater run THIS copy of the script against
rem ANOTHER installation (NSIS extracts its own current copy so an upgrade
rem never depends on the possibly older script already on disk).

if /i "%~1"=="stop" goto STOP
if /i "%~1"=="stop-all" goto STOPALL
if /i "%~1"=="start" goto START
echo Usage: %~nx0 {start^|stop^|stop-all} [dir]
exit /b 2

rem Target dir defaults to this script's folder; an explicit second argument
rem overrides it (used by installers running their own embedded copy).
set "CTLDIR=%~dp0"
if not "%~2"=="" set "CTLDIR=%~2"
if "%CTLDIR:~-1%"=="\" set "CTLDIR=%CTLDIR:~0,-1%"

:STOP
call :WAIT_STOPPED
exit /b 0

:STOPALL
rem Stop the WinSW service first, WAITING for SERVICE_STOPPED, then any
rem node.exe started by hand from the install dir. A stop REQUEST returning is
rem not enough: while SCM reports STOP_PENDING the graceful drain runs (up to
rem 8s, packaging/graceful-shutdown.cjs DEFAULT_DRAIN_MS) and PrivGateConsole.exe
rem plus node.exe stay locked, which is what makes file swaps fail with
rem "cannot delete". Escalation: taskkill /F /T on the wrapper PID.
call :WAIT_STOPPED
call :KILL_STRAYS
rem <onfailure action="restart"/> can relaunch the service between the two
rem steps above; give the wait loop one final pass before declaring quiet.
call :WAIT_STOPPED
exit /b 0

:START
pushd "%CTLDIR%"
if exist node.exe if exist write-env.cjs (
  node.exe write-env.cjs --dir "%ProgramData%\PrivGate" --preserve
)
if exist PrivGateConsole.exe (
  rem Re-running install on an existing service UPDATES it in place (same
  rem WinSW id); it must never delete/recreate the service identity.
  PrivGateConsole.exe install
  PrivGateConsole.exe start
)
popd
exit /b 0

:WAIT_STOPPED
rem Locale-proof polling: PowerShell enum names (Status -eq 'Stopped') do not
rem vary with the OS display language, unlike parsing `sc query` text.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$n='PrivGateConsole';$w=Join-Path $args[0] 'PrivGateConsole.exe';function GS{Get-Service -Name $n -ErrorAction SilentlyContinue};function WP{@(Get-CimInstance Win32_Process -Filter 'Name=''PrivGateConsole.exe''' -ErrorAction SilentlyContinue|Where-Object{$_.ExecutablePath -eq $w}).ProcessId};$s=GS;if($s -and $s.Status -ne 'Stopped'){& sc.exe stop $n | Out-Null;$i=0;while($i -lt 40){Start-Sleep -Milliseconds 500;$s=GS;if(-not $s -or $s.Status -eq 'Stopped'){break};$i++};if($s -and $s.Status -ne 'Stopped'){foreach($p in WP){& taskkill.exe /F /T /PID $p | Out-Null};$j=0;while($j -lt 20){Start-Sleep -Milliseconds 500;$s=GS;if(-not $s -or $s.Status -eq 'Stopped'){break};$j++}}};exit 0" "%CTLDIR%"
exit /b 0

:KILL_STRAYS
rem A hand-started node.exe host.cjs is not a service, so neither NSIS nor
rem msiexec knows about it - but it locks every payload file. Graceful
rem taskkill first (POSIX SIGTERM parity), short drain window, then force.
powershell -NoProfile -ExecutionPolicy Bypass -Command "$e=Join-Path $args[0] 'node.exe';function NP{@(Get-CimInstance Win32_Process -Filter 'Name=''node.exe''' -ErrorAction SilentlyContinue|Where-Object{$_.ExecutablePath -eq $e}).ProcessId};$p=NP;if($p){foreach($x in $p){& taskkill.exe /PID $x | Out-Null};$i=0;while(($i -lt 8) -and (NP)){Start-Sleep -Milliseconds 500;$i++};foreach($x in NP){& taskkill.exe /F /T /PID $x | Out-Null}};exit 0" "%CTLDIR%"
exit /b 0
