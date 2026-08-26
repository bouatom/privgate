@echo off
setlocal EnableExtensions
if not defined ProgramData set "ProgramData=C:\ProgramData"

rem Installs or removes the inbound Windows Firewall exceptions for the
rem PrivGate management console:
rem   "PrivGate Console (web)"  TCP 3000 (or PRIVGATE_WEB_PORT from console.env)
rem   "PrivGate Agent broker"   TCP 3001 (or PRIVGATE_AGENT_PORT)
rem
rem Usage: firewall-console.cmd add | remove
rem
rem Invoked by the MSI custom actions and safe to run by hand from an elevated
rem prompt. Ports resolve from %ProgramData%\PrivGate\console.env so an upgrade
rem onto a host that changed ports keeps working; anything unparsable falls
rem back to the documented defaults (the same ones write-env.cjs uses). A host
rem without the firewall service (Server Core, hardened images) makes netsh
rem fail: that is reported but never fatal, because the MSI schedules this
rem helper with Return="ignore" and the NSIS setup logs without aborting.

if /i "%~1"=="add" goto ADD
if /i "%~1"=="remove" goto REMOVE
echo firewall-console: usage: %~nx0 add^|remove >&2
exit /b 2

:ADD
set "WEBPORT=3000"
set "AGENTPORT=3001"
if exist "%ProgramData%\PrivGate\console.env" (
  call :PORT_FROM_ENV PRIVGATE_WEB_PORT WEBPORT
  call :PORT_FROM_ENV PRIVGATE_AGENT_PORT AGENTPORT
)
call :ALLOW_IN "PrivGate Console (web)" %WEBPORT%
call :ALLOW_IN "PrivGate Agent broker" %AGENTPORT%
echo firewall-console: inbound rules ready (web %WEBPORT%, broker %AGENTPORT%)
exit /b 0

:REMOVE
netsh advfirewall firewall delete rule name="PrivGate Console (web)" >nul 2>&1
netsh advfirewall firewall delete rule name="PrivGate Agent broker" >nul 2>&1
echo firewall-console: inbound rules removed
exit /b 0

:ALLOW_IN
rem %1 = quoted rule name, %2 = port. Delete-then-add keeps re-runs idempotent.
netsh advfirewall firewall delete rule name=%1 >nul 2>&1
netsh advfirewall firewall add rule name=%1 dir=in action=allow protocol=TCP localport=%2 >nul 2>&1
if errorlevel 1 echo firewall-console: WARNING - netsh could not create rule %1 (port %2). Is the Windows Firewall service running?
goto :eof

:PORT_FROM_ENV
rem %1 = env key, %2 = variable to update. Kept untouched unless the value is
rem pure digits in range, so quotes/comments/CR leftovers cannot poison netsh.
set "FWE_VALUE="
for /f "usebackq tokens=2 delims==" %%A in (`findstr /B /L /C:"%1=" "%ProgramData%\PrivGate\console.env" 2^>nul`) do if not defined FWE_VALUE set "FWE_VALUE=%%A"
if not defined FWE_VALUE goto :eof
set /a FWE_NUM=FWE_VALUE 2>nul
if not defined FWE_NUM goto :eof
if %FWE_NUM% LSS 1 goto :eof
if %FWE_NUM% GTR 65535 goto :eof
if not "%FWE_NUM%"=="%FWE_VALUE%" goto :eof
endlocal & set "%~2=%FWE_VALUE%"
goto :eof
