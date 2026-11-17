#requires -Version 5.1
<#
  daytime desktop launcher. Use daytime.cmd in the project root (or npm):

    daytime                 build if needed, then start the note
    daytime build           compile desktop\DaytimeNote.exe
    daytime install         install to %LOCALAPPDATA%\daytime, add a Start Menu
                            shortcut, start with Windows, and launch it
    daytime uninstall       remove the installed copy and its shortcuts

  Options:
    -NoStartup   (install)            do not start with Windows
    -NoLaunch    (install)            do not launch after installing
    -Fresh       (install, uninstall) also delete the WebView2 profile, which
                                      holds the Google sign-in and cache

  Building uses the C# compiler that ships with Windows (.NET Framework 4),
  so nothing has to be downloaded.
#>
param(
    [ValidateSet("run", "build", "install", "uninstall")]
    [string]$Command = "run",
    [switch]$NoStartup,
    [switch]$NoLaunch,
    [switch]$Fresh
)

$ErrorActionPreference = "Stop"

$desktop = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $desktop
$source = Join-Path $desktop "DaytimeNote.cs"
$exe = Join-Path $desktop "DaytimeNote.exe"
$dlls = @("Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll")

# The files the note serves. Keep in sync with public-files.js.
$webFiles = @("index.html", "styles.css", "app.js", "core.js", "cities.js", "config.js", "logo.svg")

$installRoot = Join-Path $env:LOCALAPPDATA "daytime"
$profileDir = Join-Path $env:APPDATA "daytime-desktop"
$startMenuLink = Join-Path ([Environment]::GetFolderPath("Programs")) "daytime.lnk"
$legacyStartupLink = Join-Path ([Environment]::GetFolderPath("Startup")) "daytime.lnk"
$runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$runValue = "daytime-desktop" # Same value the tray's "Start with Windows" toggles.

function Stop-Daytime([string]$Under) {
    $running = Get-Process -Name "DaytimeNote" -ErrorAction SilentlyContinue |
        Where-Object { -not $Under -or ($_.Path -and $_.Path.StartsWith($Under, [StringComparison]::OrdinalIgnoreCase)) }
    if ($running) {
        $running | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 800
    }
}

function Test-NeedsBuild {
    if (-not (Test-Path $exe)) { return $true }
    return (Get-Item $source).LastWriteTimeUtc -gt (Get-Item $exe).LastWriteTimeUtc
}

function Invoke-Build {
    $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
    if (-not (Test-Path $csc)) {
        throw "The .NET Framework C# compiler was not found at $csc."
    }

    # A running copy locks the exe.
    Stop-Daytime -Under $desktop

    Write-Host "Building DaytimeNote.exe..."
    $references = @("System.dll", "System.Core.dll", "System.Drawing.dll", "System.Windows.Forms.dll") +
        ($dlls | Where-Object { $_ -ne "WebView2Loader.dll" } | ForEach-Object { Join-Path $desktop $_ })
    $arguments = @("/nologo", "/target:winexe", "/platform:x64", "/optimize+", "/out:$exe") +
        ($references | ForEach-Object { "/r:$_" }) + @($source)

    & $csc @arguments
    if ($LASTEXITCODE -ne 0) { throw "Build failed." }
    Write-Host "Built $exe"
}

function Set-Shortcut([string]$Path, [string]$Target) {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Path)
    $link.TargetPath = $Target
    $link.WorkingDirectory = Split-Path -Parent $Target
    $link.Description = "daytime clock and calendar"
    $link.Save()
}

function Invoke-Install {
    if (Test-NeedsBuild) { Invoke-Build }

    Stop-Daytime
    if ($Fresh) { Remove-Item $profileDir -Recurse -Force -ErrorAction SilentlyContinue }

    # Clear out the previous install (including app-<timestamp> fallbacks).
    $target = Join-Path $installRoot "app"
    Get-ChildItem $installRoot -Directory -Filter "app*" -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path $target) {
        # Something still holds a file open: install beside it instead of failing.
        $target = Join-Path $installRoot ("app-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    }

    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item $exe $target
    foreach ($dll in $dlls) { Copy-Item (Join-Path $desktop $dll) $target }
    foreach ($file in $webFiles) { Copy-Item (Join-Path $repo $file) $target }
    New-Item -ItemType Directory -Force -Path (Join-Path $target "icons") | Out-Null
    Copy-Item (Join-Path $repo "icons\icon-192.png") (Join-Path $target "icons")

    $installedExe = Join-Path $target "DaytimeNote.exe"
    Set-Shortcut $startMenuLink $installedExe
    Write-Host "Start Menu: daytime"

    # Older installers used a Startup-folder shortcut; the Run value replaces it.
    Remove-Item $legacyStartupLink -Force -ErrorAction SilentlyContinue
    if ($NoStartup) {
        Remove-ItemProperty -Path $runKey -Name $runValue -ErrorAction SilentlyContinue
    } else {
        Set-ItemProperty -Path $runKey -Name $runValue -Value ('"' + $installedExe + '"')
        Write-Host "Starts with Windows (turn off from the tray icon)."
    }

    Write-Host "Installed to $target"
    if (-not $NoLaunch) { Start-Process -FilePath $installedExe }
}

function Invoke-Uninstall {
    Stop-Daytime -Under $installRoot
    Remove-Item $startMenuLink, $legacyStartupLink -Force -ErrorAction SilentlyContinue
    $registered = (Get-ItemProperty -Path $runKey -Name $runValue -ErrorAction SilentlyContinue).$runValue
    if ($registered -and $registered.Contains($installRoot)) {
        Remove-ItemProperty -Path $runKey -Name $runValue -ErrorAction SilentlyContinue
    }
    Remove-Item $installRoot -Recurse -Force -ErrorAction SilentlyContinue
    if ($Fresh) { Remove-Item $profileDir -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Host "daytime was uninstalled."
}

switch ($Command) {
    "build" { Invoke-Build }
    "install" { Invoke-Install }
    "uninstall" { Invoke-Uninstall }
    default {
        if (Test-NeedsBuild) { Invoke-Build }
        # A second launch just brings the running note to the front.
        Start-Process -FilePath $exe
    }
}
