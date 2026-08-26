# Signe Zcord-Setup.exe (supprime SmartScreen si certificat valide)
# Usage:
#   $env:ZCORD_CERT_FILE = "C:\chemin\cert.pfx"
#   $env:ZCORD_CERT_PASSWORD = "motdepasse"
#   .\scripts\sign-windows.ps1
param(
    [string]$File = "",
    [string]$CertFile = $env:ZCORD_CERT_FILE,
    [string]$CertPassword = $env:ZCORD_CERT_PASSWORD,
    [string]$TimestampUrl = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
if (-not $File) {
    $File = Join-Path $root "release\Zcord-Setup.exe"
}

if (-not (Test-Path $File)) {
    Write-Error "Fichier introuvable: $File"
}
if (-not $CertFile -or -not (Test-Path $CertFile)) {
    Write-Host ""
    Write-Host "Certificat manquant (ZCORD_CERT_FILE)."
    Write-Host "Sans certificat Authenticode, Windows affiche SmartScreen."
    Write-Host "Certificats gratuits open-source: https://signpath.io"
    Write-Host "Ou achat: DigiCert, Sectigo (~200 EUR/an)."
    Write-Host ""
    exit 1
}

$signtool = Get-Command signtool.exe -ErrorAction SilentlyContinue
if (-not $signtool) {
    $kits = "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe"
    $signtool = Get-ChildItem $kits -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
}
if (-not $signtool) {
    Write-Error "signtool.exe introuvable — installe Windows SDK"
}

$passArg = if ($CertPassword) { "/p $CertPassword" } else { "" }
& $signtool sign /f $CertFile $passArg /tr $TimestampUrl /td sha256 /fd sha256 $File

$status = (Get-AuthenticodeSignature $File).Status
Write-Host "Signature: $status — $File"
if ($status -ne "Valid") { exit 1 }
