#requires -Version 5.1
# Installs daytime as a normal desktop app:
#   %LOCALAPPDATA%\daytime\app\DaytimeNote.exe   (self-contained copy)
#   Start Menu shortcut + Start with Windows shortcut
# Run install-daytime.cmd instead of calling this file directly.
#
# A running instance locks its exe. If the folder cannot be cleared, the new
# build is installed into a fresh app-<timestamp> folder and the shortcuts are
# repointed at it, so the install always succeeds.

param([switch]$NoLaunch, [switch]$Fresh)

$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $source
$root = Join-Path $env:LOCALAPPDATA "daytime"
$target = Join-Path $root "app"

Write-Host "Installing daytime into $root"

Get-Process -Name "DaytimeNote" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 800

# The WebView2 profile holds the Google session. Keep it by default so an
# update does not force a fresh sign-in; -Fresh wipes it (and the cache).
if ($Fresh) {
    Remove-Item (Join-Path $env:APPDATA "daytime-desktop") -Recurse -Force -ErrorAction SilentlyContinue
}

for ($attempt = 0; $attempt -lt 6; $attempt++) {
    Remove-Item $target -Recurse -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path $target)) { break }
    Start-Sleep -Milliseconds 500
}

if (Test-Path $target) {
    $target = Join-Path $root ("app-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    Write-Host "The old folder is still locked; installing to $target instead."
}

New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item (Join-Path $source "native\DaytimeNote.exe") $target -Force
Copy-Item (Join-Path $source "native\*.dll") $target -Force

$webFiles = @(
    "index.html", "styles.css", "app.js", "core.js", "cities.js", "config.js",
    "sw.js", "manifest.webmanifest", "logo.svg"
)
foreach ($file in $webFiles) {
    $path = Join-Path $repo $file
    if (Test-Path $path) { Copy-Item $path $target -Force }
}
if (Test-Path (Join-Path $repo "icons")) {
    Copy-Item (Join-Path $repo "icons") $target -Recurse -Force
}

$exe = Join-Path $target "DaytimeNote.exe"
$shell = New-Object -ComObject WScript.Shell

try {
    $startMenu = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs\daytime.lnk"
    $shortcut = $shell.CreateShortcut($startMenu)
    $shortcut.TargetPath = $exe
    $shortcut.WorkingDirectory = $target
    $shortcut.Description = "daytime clock and calendar"
    $shortcut.Save()
    Write-Host "Start Menu shortcut: $startMenu"
} catch {
    Write-Host "Could not create the Start Menu shortcut: $($_.Exception.Message)"
}

try {
    $startupDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs\Startup"
    $startup = Join-Path $startupDir "daytime.lnk"
    $login = $shell.CreateShortcut($startup)
    $login.TargetPath = $exe
    $login.WorkingDirectory = $target
    $login.Description = "daytime clock and calendar"
    $login.Save()
    Write-Host "Starts with Windows: $startup"
} catch {
    Write-Host "Could not create the startup shortcut: $($_.Exception.Message)"
}

Write-Host "Installed: $exe"
Write-Host ""
Write-Host "If Windows shows 'Windows protected your PC', choose More info -> Run anyway."

if (-not $NoLaunch) {
    Write-Host "Launching daytime..."
    Start-Process -FilePath $exe
}
exit 0
