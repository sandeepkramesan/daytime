@echo off
rem Installs daytime as a normal Windows app (Start Menu + Start with Windows)
rem and launches it. Run this once; afterwards use the Start Menu shortcut.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-daytime.ps1"
if errorlevel 1 (
  echo.
  echo Installation failed. Right-click install-daytime.ps1 and choose "Run with PowerShell".
)
pause
