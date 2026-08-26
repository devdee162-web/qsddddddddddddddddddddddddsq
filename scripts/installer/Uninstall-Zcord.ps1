# Zcord — Desinstallation (Parametres Windows > Applications)
param(
    [switch]$Silent,
    [switch]$KeepData
)

$ErrorActionPreference = "Stop"
$AppName = "Zcord"
$UninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Zcord"

function Get-InstallDir {
    if (Test-Path $UninstallKey) {
        $loc = (Get-ItemProperty $UninstallKey -ErrorAction SilentlyContinue).InstallLocation
        if ($loc -and (Test-Path $loc)) { return $loc }
    }
    $fallback = Join-Path $env:LOCALAPPDATA "Programs\Zcord"
    if (Test-Path $fallback) { return $fallback }
    throw "Zcord n'est pas installe."
}

function Stop-Zcord {
    Get-Process -ErrorAction SilentlyContinue | Where-Object {
        $_.Path -and ($_.Path -like "*\Zcord.exe" -or $_.Name -eq "Zcord")
    } | Stop-Process -Force -ErrorAction SilentlyContinue
}

function Remove-ShortcutIfExists([string]$Path) {
    if (Test-Path $Path) { Remove-Item $Path -Force -ErrorAction SilentlyContinue }
}

$InstallDir = Get-InstallDir
Stop-Zcord

if (-not $Silent -and -not $KeepData) {
    Add-Type -AssemblyName System.Windows.Forms
    $r = [System.Windows.Forms.MessageBox]::Show(
        "Supprimer aussi tes donnees Zcord (compte, parametres) ?`n`nOui = tout supprimer`nNon = garde les donnees",
        "Desinstaller Zcord",
        [System.Windows.Forms.MessageBoxButtons]::YesNoCancel,
        [System.Windows.Forms.MessageBoxIcon]::Question
    )
    if ($r -eq [System.Windows.Forms.DialogResult]::Cancel) { exit 0 }
    $KeepData = ($r -eq [System.Windows.Forms.DialogResult]::No)
}

try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue | Out-Null
    $desktop = [Environment]::GetFolderPath("Desktop")
} catch {
    $desktop = Join-Path $env:USERPROFILE "Desktop"
}

$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
Remove-ShortcutIfExists (Join-Path $startMenu "$AppName.lnk")
Remove-ShortcutIfExists (Join-Path $startMenu "Zcord.lnk")
if ($desktop) {
    Remove-ShortcutIfExists (Join-Path $desktop "$AppName.lnk")
    Remove-ShortcutIfExists (Join-Path $desktop "Zcord.lnk")
}

if (-not $KeepData) {
    Remove-Item (Join-Path $InstallDir "Data") -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $InstallDir "ZcordData") -Recurse -Force -ErrorAction SilentlyContinue
}

Remove-Item $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $UninstallKey -Recurse -Force -ErrorAction SilentlyContinue

if (-not $Silent) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show(
        "Zcord a ete desinstalle.",
        "Zcord",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
}
