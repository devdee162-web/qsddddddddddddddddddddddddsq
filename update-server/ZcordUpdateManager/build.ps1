# Build Zcord Update Manager — lanceur sans fenetre console
param(
    [switch]$Run,
    [switch]$PublishOnly
)

$ErrorActionPreference = "Stop"
$ScriptDir = $PSScriptRoot
$proj = Join-Path $ScriptDir "ZcordUpdateManager.csproj"
$outDir = Join-Path $ScriptDir "dist"
$launcherVbs = Join-Path $outDir "Zcord Update Manager.vbs"
$launcherBat = Join-Path $outDir "Zcord Update Manager.bat"

function Find-DotNet {
    if (Get-Command dotnet -ErrorAction SilentlyContinue) { return "dotnet" }
    $p = "$env:ProgramFiles\dotnet\dotnet.exe"
    if (Test-Path $p) { return $p }
    return $null
}

$dotnet = Find-DotNet
if (-not $dotnet) {
    Write-Host ".NET 8 SDK requis : winget install Microsoft.DotNet.SDK.8" -ForegroundColor Yellow
    exit 1
}

Set-Location $ScriptDir
if (Test-Path $outDir) { Remove-Item $outDir -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

Write-Host "Compilation..." -ForegroundColor Cyan
& $dotnet publish $proj -c Release -r win-x64 --self-contained false -p:UseAppHost=false -o $outDir
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# VBS = lanceur principal (pas de console noire)
$vbs = @'
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
dotnetExe = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\dotnet\dotnet.exe"
If Not fso.FileExists(dotnetExe) Then dotnetExe = "dotnet"
dll = dir & "\ZcordUpdateManager.dll"
sh.Run """" & dotnetExe & """ """ & dll & """", 1, False
'@
Set-Content -Path $launcherVbs -Value $vbs -Encoding ASCII

# BAT redirige vers VBS (double-clic facile, zero console)
$bat = @'
@echo off
cd /d "%~dp0"
start "" wscript.exe //nologo "%~dp0Zcord Update Manager.vbs"
exit
'@
Set-Content -Path $launcherBat -Value $bat -Encoding ASCII

# Supprimer vieux exe bloques s'il reste
Get-ChildItem $outDir -Filter "*.exe" -ErrorAction SilentlyContinue | Remove-Item -Force

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Pret : $outDir" -ForegroundColor Green
Write-Host "  Double-clic : Zcord Update Manager.bat" -ForegroundColor Cyan
Write-Host "            ou : Zcord Update Manager.vbs" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green

if ($Run -and -not $PublishOnly) {
    Start-Process $launcherVbs
}
