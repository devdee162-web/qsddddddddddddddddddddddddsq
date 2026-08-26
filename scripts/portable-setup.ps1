# Installe Zcord comme une vraie app (Bureau + Menu Demarrer). Une seule fois.
param(
    [string]$Root = $PSScriptRoot
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path $Root).Path
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\Zcord"
$setupPs1 = Join-Path $Root "Setup Shortcut.ps1"

if (-not (Test-Path (Join-Path $Root "Zcord.exe"))) {
    Write-Error "Zcord.exe introuvable. Ouvre ce script depuis le dossier zcord-dist."
}

# Copie vers AppData (emplacement propre, comme une app installee)
$RootNorm = $Root.TrimEnd('\').ToLower()
$InstallNorm = $InstallDir.TrimEnd('\').ToLower()
if ($RootNorm -ne $InstallNorm) {
    Write-Host "Installation de Zcord dans : $InstallDir"
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    robocopy $Root $InstallDir /MIR /XD "ZcordData" /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { Write-Error "Copie echouee (robocopy $LASTEXITCODE)" }
    # Supprime le doublon Discord.exe si present
    $dup = Join-Path $InstallDir "Discord.exe"
    if (Test-Path $dup) { Remove-Item $dup -Force -ErrorAction SilentlyContinue }
    $Root = $InstallDir
    $setupPs1 = Join-Path $Root "Setup Shortcut.ps1"
} else {
    Write-Host "Zcord deja installe dans AppData."
}

$ExePath = Join-Path $Root "Zcord.exe"
$IconPath = Join-Path $Root "app.ico"
if (-not (Test-Path $IconPath)) { $IconPath = $ExePath }

if (-not (Test-Path $setupPs1)) {
    Write-Error "Setup Shortcut.ps1 manquant."
}

function New-ZcordShortcut([string]$LnkPath) {
    & $setupPs1 -ExePath $ExePath -IconPath $IconPath -ShortcutPath $LnkPath -WorkingDirectory $Root
}

try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue | Out-Null
    $desktop = [Environment]::GetFolderPath("Desktop")
} catch {
    $desktop = Join-Path $env:USERPROFILE "Desktop"
}

$startMenu = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
New-Item -ItemType Directory -Force -Path $startMenu | Out-Null

New-ZcordShortcut (Join-Path $startMenu "Zcord.lnk")
if ($desktop) { New-ZcordShortcut (Join-Path $desktop "Zcord.lnk") }

Write-Host ""
Write-Host "========================================"
Write-Host "  Zcord est pret !"
Write-Host "  Lance-le depuis l'icone Zcord sur ton Bureau."
Write-Host "  (Tu peux fermer ce dossier, plus besoin d'y toucher.)"
Write-Host "========================================"
Write-Host ""

Start-Process $ExePath
