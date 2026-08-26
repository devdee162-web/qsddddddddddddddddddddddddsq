# Installe Discord Stable silencieusement pour le build CI (GitHub Actions).
$ErrorActionPreference = "Stop"

$discordBase = Join-Path $env:LOCALAPPDATA "Discord"
if (Test-Path $discordBase) {
    $existing = Get-ChildItem $discordBase -Directory -Filter "app-*" -ErrorAction SilentlyContinue |
        Sort-Object { [version]($_.Name -replace "^app-", "") } -Descending |
        Select-Object -First 1
    if ($existing) {
        Write-Host "[ci] Discord deja installe: $($existing.FullName)"
        "DISCORD_APP_PATH=$($existing.FullName)" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
        exit 0
    }
}

$installer = Join-Path $env:RUNNER_TEMP "DiscordSetup.exe"
Write-Host "[ci] Telechargement Discord Stable..."
Invoke-WebRequest -Uri "https://discord.com/api/download?platform=win" -OutFile $installer -UseBasicParsing

Write-Host "[ci] Installation silencieuse (/S)..."
$p = Start-Process -FilePath $installer -ArgumentList "/S" -PassThru -Wait
if ($p.ExitCode -ne 0 -and $p.ExitCode -ne $null) {
    Write-Warning "[ci] DiscordSetup exit code: $($p.ExitCode)"
}

# Squirrel peut mettre quelques secondes a materialiser app-* 
$deadline = (Get-Date).AddMinutes(3)
$appPath = $null
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    if (-not (Test-Path $discordBase)) { continue }
    $appPath = Get-ChildItem $discordBase -Directory -Filter "app-*" -ErrorAction SilentlyContinue |
        Sort-Object { [version]($_.Name -replace "^app-", "") } -Descending |
        Select-Object -First 1
    if ($appPath) { break }
}

if (-not $appPath) {
    throw "Discord introuvable apres installation dans $discordBase"
}

Write-Host "[ci] DISCORD_APP_PATH=$($appPath.FullName)"
"DISCORD_APP_PATH=$($appPath.FullName)" | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
