@echo off
setlocal EnableExtensions
if not defined ProgramData set ProgramData=C:\ProgramData

rem Controls the PrivGate console service. Used by admins and by installers.
rem
rem Usage: service-ctl.cmd start
rem        service-ctl.cmd stop
rem        service-ctl.cmd stop-all [install-dir]
rem
rem [install-dir] lets an installer/updater run THIS copy of the script against
rem ANOTHER installation (NSIS extracts its own current copy so an upgrade
rem never depends on the possibly older script already on disk).
rem Without it, the folder holding this script is used.

rem Resolve the target dir BEFORE dispatching: these three lines used to sit
rem below the usage exit and never ran, so every use of %CTLDIR% expanded to
rem empty and the helper polled/killed against a null path.
set "CTLDIR=%~dp0"
if not "%~2"=="" set "CTLDIR=%~2"
if "%CTLDIR:~-1%"=="\" set "CTLDIR=%CTLDIR:~0,-1%"

if /i "%~1"=="start" goto START
if /i "%~1"=="stop" goto STOP
if /i "%~1"=="stop-all" goto STOPALL
echo service-ctl: unknown action "%~1".
echo Usage: service-ctl.cmd start - refresh env and install/start the console service.
echo Usage: service-ctl.cmd stop - stop the console service and wait until it reports stopped.
echo Usage: service-ctl.cmd stop-all [install-dir] - stop the console service and stop any node.exe left running from install-dir.
echo install-dir defaults to the folder containing this script. Resolved install dir: "%CTLDIR%"
exit /b 2

:STOP
echo service-ctl: stopping service "PrivGateConsole" - install dir "%CTLDIR%"
call :WAIT_STOPPED
exit /b %errorlevel%

:STOPALL
echo service-ctl: stop-all requested - stopping service "PrivGateConsole" plus any node.exe under "%CTLDIR%"
call :WAIT_STOPPED
call :KILL_STRAYS
rem <onfailure action="restart"/> can relaunch the service between the two
rem steps above; give the wait loop one final pass before declaring quiet.
call :WAIT_STOPPED
exit /b %errorlevel%

:START
echo service-ctl: start requested - install dir "%CTLDIR%"
pushd "%CTLDIR%"
if errorlevel 1 (
  echo service-ctl: cannot enter install dir "%CTLDIR%" - nothing started.
  exit /b 1
)
set "RC=0"
if exist node.exe if exist write-env.cjs (
  echo service-ctl: refreshing environment file in "%ProgramData%\PrivGate"
  node.exe write-env.cjs --dir "%ProgramData%\PrivGate" --preserve
)
if exist PrivGateConsole.exe (
  rem Re-running install on an existing service UPDATES it in place (same
  rem WinSW id); it must never delete/recreate the service identity.
  echo service-ctl: installing and starting service "PrivGateConsole"
  PrivGateConsole.exe install
  if errorlevel 1 set "RC=1"
  PrivGateConsole.exe start
  if errorlevel 1 set "RC=1"
) else (
  echo service-ctl: WARNING - no PrivGateConsole.exe in "%CTLDIR%" - nothing to start.
)
popd
exit /b %RC%

:WAIT_STOPPED
echo service-ctl: waiting for service "PrivGateConsole" to report stopped
rem Locale-proof polling: PowerShell enum names (Status -eq 'Stopped') do not
rem vary with the OS display language, unlike parsing `sc query` text. A missing
rem or empty install dir degrades stray-process matching to disabled; it must
rem never surface a bare "parameter is null" binding error again.
rem
rem Pass the install dir via the environment, never as a trailing -Command
rem argument. powershell.exe -Command concatenates leftover argv onto the
rem script text, so `"%CTLDIR%"` with a space (Program Files) became
rem `exit 0 C:\Program Files\...` and $d stayed empty — stray node.exe was
rem never killed (prod 10.0.2.25: service Stopped, node still on :3000).
set "PRIVGATE_CTLDIR=%CTLDIR%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[string]$env:PRIVGATE_CTLDIR;$n='PrivGateConsole';$w='';if($d){$w=Join-Path $d 'PrivGateConsole.exe'};function GS{Get-Service -Name $n -ErrorAction SilentlyContinue};function WP{@(Get-CimInstance Win32_Process -Filter 'Name=''PrivGateConsole.exe''' -ErrorAction SilentlyContinue|Where-Object{$_.ExecutablePath -eq $w}).ProcessId};$s=GS;if(-not $s){Write-Output 'service-ctl: service PrivGateConsole is not installed - nothing to wait for';exit 0};if($s.Status -eq 'Stopped'){Write-Output 'service-ctl: service PrivGateConsole already stopped';exit 0};Write-Output ('service-ctl: service status is ' + $s.Status + ' - sending stop request');& sc.exe stop $n | Out-Null;$i=0;while($i -lt 40){Start-Sleep -Milliseconds 500;$s=GS;if(-not $s -or $s.Status -eq 'Stopped'){break};$i++};if($s -and $s.Status -ne 'Stopped'){Write-Output 'service-ctl: still running after 20s - force-stopping wrapper process tree';foreach($p in WP){& taskkill.exe /F /T /PID $p | Out-Null};$j=0;while($j -lt 20){Start-Sleep -Milliseconds 500;$s=GS;if(-not $s -or $s.Status -eq 'Stopped'){break};$j++}};if($s -and $s.Status -ne 'Stopped'){Write-Output ('service-ctl: ERROR - service PrivGateConsole still ' + $s.Status + ' after escalation');exit 1};Write-Output 'service-ctl: service PrivGateConsole stopped';exit 0"
exit /b %errorlevel%

:KILL_STRAYS
echo service-ctl: checking for node.exe processes started from "%CTLDIR%"
rem A hand-started node.exe host.cjs is not a service, so neither NSIS nor
rem msiexec knows about it - but it locks every payload file. Graceful
rem taskkill first (POSIX SIGTERM parity), short drain window, then force.
set "PRIVGATE_CTLDIR=%CTLDIR%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d=[string]$env:PRIVGATE_CTLDIR;$e='';if($d){$e=Join-Path $d 'node.exe'};function NP{@(Get-CimInstance Win32_Process -Filter 'Name=''node.exe''' -ErrorAction SilentlyContinue|Where-Object{$_.ExecutablePath -eq $e}).ProcessId};$p=NP;if(-not $p){Write-Output 'service-ctl: no stray node.exe processes found';exit 0};Write-Output ('service-ctl: graceful-stopping stray node.exe id ' + (@($p) -join ', '));foreach($x in @($p)){& taskkill.exe /PID $x | Out-Null};$i=0;while(($i -lt 8) -and (NP)){Start-Sleep -Milliseconds 500;$i++};$rest=NP;if($rest){Write-Output ('service-ctl: force-stopping stray node.exe id ' + (@($rest) -join ', '));foreach($x in @($rest)){& taskkill.exe /F /T /PID $x | Out-Null}}else{Write-Output 'service-ctl: stray node.exe exited gracefully'};exit 0"
exit /b 0
