@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if not defined ProgramData set ProgramData=C:\ProgramData

if /i "%~1"=="stop" goto STOP
if /i "%~1"=="stop-all" goto STOPALL
if /i "%~1"=="start" goto START
echo Usage: %~nx0 {start^|stop^|stop-all}
exit /b 2

:STOP
if exist PrivGateConsole.exe PrivGateConsole.exe stop
sc stop PrivGateConsole >nul 2>&1
exit /b 0

:STOPALL
rem Stop the WinSW service first, then any console started by hand.
rem A hand-started node.exe host.cjs is not a service, so neither NSIS nor
rem msiexec knows about it — but it locks every payload file during updates.
call :STOP
set "CTLDIR=%~dp0"
if "%CTLDIR:~-1%"=="\" set "CTLDIR=%CTLDIR:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$dir=$args[0]; $exe=Join-Path $dir 'node.exe'; Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | ForEach-Object { & taskkill /PID $_.Id | Out-Null }; Start-Sleep -Milliseconds 800; Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $exe } | Stop-Process -Force" "%CTLDIR%"
exit /b 0

:START
if exist node.exe if exist write-env.cjs (
  node.exe write-env.cjs --dir "%ProgramData%\PrivGate" --preserve
)
if exist PrivGateConsole.exe (
  PrivGateConsole.exe install
  PrivGateConsole.exe start
)
exit /b 0
