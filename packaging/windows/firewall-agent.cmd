@echo off
setlocal EnableExtensions

rem Keeps PrivGate.Agent.exe able to dial its management console when the PC
rem runs an outbound-restrictive Windows Firewall policy. PrivGate.Helper.exe
rem talks over a local named pipe only and needs no rule.
rem
rem Usage: firewall-agent.cmd add | remove
rem
rem Invoked by the client MSI custom actions; the rule name matches the one the
rem PowerShell installers create ("PrivGate Agent"), so all deployment flavors
rem stay interchangeable. A host without the firewall service makes netsh fail:
rem that is reported but never fatal, because the MSI schedules this helper
rem with Return="ignore".

if /i "%~1"=="add" goto ADD
if /i "%~1"=="remove" goto REMOVE
echo firewall-agent: usage: %~nx0 add^|remove >&2
exit /b 2

:ADD
set "AGENTBIN=%~dp0PrivGate.Agent.exe"
if not exist "%AGENTBIN%" (
  echo firewall-agent: WARNING - %AGENTBIN% not found; outbound rule not created.
  exit /b 1
)
netsh advfirewall firewall delete rule name="PrivGate Agent" >nul 2>&1
netsh advfirewall firewall add rule name="PrivGate Agent" dir=out action=allow program="%AGENTBIN%" profile=any >nul 2>&1
if errorlevel 1 echo firewall-agent: WARNING - netsh could not create the outbound rule. Is the Windows Firewall service running?
echo firewall-agent: outbound rule ready for %AGENTBIN%
exit /b 0

:REMOVE
netsh advfirewall firewall delete rule name="PrivGate Agent" >nul 2>&1
echo firewall-agent: outbound rule removed
exit /b 0
