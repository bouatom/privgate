@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if not defined ProgramData set ProgramData=C:\ProgramData

if /i "%~1"=="stop" goto STOP
goto START

:STOP
if exist PrivGateConsole.exe PrivGateConsole.exe stop
sc stop PrivGateConsole >nul 2>&1
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
