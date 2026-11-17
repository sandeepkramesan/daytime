@echo off
rem daytime desktop note. Double-click to start it (it is built on first run).
rem   daytime install     install with a Start Menu shortcut and start with Windows
rem   daytime uninstall   remove the installed copy
rem   daytime build       rebuild desktop\DaytimeNote.exe
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0desktop\daytime.ps1" %*
if errorlevel 1 (
  echo.
  echo daytime could not start. See the message above.
  pause
  exit /b 1
)
