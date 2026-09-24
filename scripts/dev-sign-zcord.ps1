# Create/reuse local "Zcord Dev" code-signing cert and sign the exe.
# Helps local WDAC/SmartScreen. Smart App Control cloud may still need a real CA.
# Usage: .\scripts\dev-sign-zcord.ps1 -File ".\release\zcord-dist\Zcord.exe"
param(
    [Parameter(Mandatory = $true)][string]$File
)

$ErrorActionPreference = "Stop"
if (-not (Test-Path -LiteralPath $File)) {
    throw "File not found: $File"
}

$subject = "CN=Zcord Dev"
$cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq $subject } |
    Select-Object -First 1

if (-not $cert) {
    Write-Host "[dev-sign] Creating local cert $subject ..."
    $cert = New-SelfSignedCertificate `
        -Type CodeSigningCert `
        -Subject $subject `
        -FriendlyName "Zcord Dev Code Signing" `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -KeyExportPolicy Exportable `
        -KeySpec Signature `
        -NotAfter (Get-Date).AddYears(5)
}

foreach ($storePath in @("Cert:\CurrentUser\TrustedPublisher", "Cert:\CurrentUser\Root")) {
    $store = Get-Item $storePath
    $store.Open("ReadWrite")
    try {
        $exists = $store.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
        if (-not $exists) {
            $store.Add($cert)
            Write-Host "[dev-sign] Added to $storePath"
        }
    } finally {
        $store.Close()
    }
}

$signtoolPath = $null
$cmd = Get-Command signtool.exe -ErrorAction SilentlyContinue
if ($cmd) {
    $signtoolPath = $cmd.Source
} else {
    $found = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending |
        Select-Object -First 1
    if ($found) { $signtoolPath = $found.FullName }
}

if ($signtoolPath) {
    & $signtoolPath sign /fd SHA256 /td SHA256 /tr http://timestamp.digicert.com /sha1 $cert.Thumbprint $File
    if ($LASTEXITCODE -ne 0) {
        & $signtoolPath sign /fd SHA256 /sha1 $cert.Thumbprint $File
    }
} else {
    Write-Host "[dev-sign] signtool missing - using Set-AuthenticodeSignature"
    try {
        Set-AuthenticodeSignature -FilePath $File -Certificate $cert -TimestampServer "http://timestamp.digicert.com" -HashAlgorithm SHA256 | Out-Null
    } catch {
        Set-AuthenticodeSignature -FilePath $File -Certificate $cert -HashAlgorithm SHA256 | Out-Null
    }
}

$status = (Get-AuthenticodeSignature -FilePath $File).Status
Write-Host "[dev-sign] Signature: $status - $File"
