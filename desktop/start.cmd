@echo off
rem Double-click this file to start the daytime desktop note outside any
rem terminal or sandbox. Log: desktop\launch.log
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
echo Starting daytime...
node start.js
echo.
echo daytime exited. Log written to %~dp0launch.log
pause
