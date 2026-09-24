# Build zcord-updater.exe (Windows)
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$Mgr = Join-Path $Root "update_manager"
$Out = Join-Path $Mgr "build"
$Inc = Join-Path $Mgr "include"
$Src = Join-Path $Mgr "src"

New-Item -ItemType Directory -Force -Path $Out | Out-Null

$sources = @(
    (Join-Path $Src "main.c"),
    (Join-Path $Src "updater.c"),
    (Join-Path $Src "http.c"),
    (Join-Path $Src "checksum.c")
)

$exe = Join-Path $Out "zcord-updater.exe"

# MinGW gcc
if (Get-Command gcc -ErrorAction SilentlyContinue) {
    & gcc -O2 -Wall "-I$Inc" @sources -o $exe -lwinhttp -lbcrypt -lshell32
    if ($LASTEXITCODE -eq 0) { Write-Host "[build] OK: $exe"; exit 0 }
}

# MSVC cl
$vsWhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vsWhere) {
    $vsPath = & $vsWhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($vsPath) {
        $vcvars = Join-Path $vsPath "VC\Auxiliary\Build\vcvars64.bat"
        if (Test-Path $vcvars) {
            $cmd = "`"$vcvars`" && cl /nologo /O2 /I`"$Inc`" $($sources -join ' ') /Fe:`"$exe`" winhttp.lib bcrypt.lib shell32.lib"
            cmd /c $cmd
            if ($LASTEXITCODE -eq 0) { Write-Host "[build] OK: $exe"; exit 0 }
        }
    }
}

Write-Error "Installe MinGW-w64 (gcc) ou Visual Studio Build Tools"
exit 1
