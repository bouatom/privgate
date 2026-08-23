@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if not defined ProgramData set ProgramData=C:\ProgramData
call "%~dp0service-ctl.cmd" start
echo PrivGate Console data: %ProgramData%\PrivGate
echo Open http://127.0.0.1:3000/setup if this is the first install.
exit /b 0
