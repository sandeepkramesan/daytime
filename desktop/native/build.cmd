@echo off
rem Rebuild the native desktop note from source (needs the .NET Framework
rem compiler that ships with Windows). Run install-daytime.cmd afterwards to
rem copy the new build into %LOCALAPPDATA%\daytime.
setlocal
cd /d "%~dp0"
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo Could not find the .NET Framework C# compiler.
  pause
  exit /b 1
)
"%CSC%" /nologo /target:winexe /platform:x64 /out:DaytimeNote.exe ^
  /r:System.dll /r:System.Core.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll ^
  /r:Microsoft.Web.WebView2.Core.dll /r:Microsoft.Web.WebView2.WinForms.dll ^
  DaytimeNote.cs
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)
echo Built DaytimeNote.exe
pause
