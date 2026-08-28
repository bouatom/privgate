@echo off
setlocal
rem Kills PrivGate.Agent.exe and PrivGate.Helper.exe so the MSI can replace
rem the binary files in place. Invoked by StopPrivGateStray on upgrade only.
taskkill /f /im PrivGate.Agent.exe >nul 2>&1
taskkill /f /im PrivGate.Helper.exe >nul 2>&1
timeout /t 1 /nobreak >nul 2>&1
exit /b 0
