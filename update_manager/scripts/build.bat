@echo off
setlocal
cd /d "%~dp0.."
if not exist build mkdir build

where gcc >nul 2>&1
if errorlevel 1 (
  echo [build] gcc introuvable — installe MinGW-w64 ou MSYS2
  exit /b 1
)

gcc -O2 -Wall -Iinclude ^
  src/main.c src/updater.c src/http.c src/checksum.c ^
  -o build/zcord-updater.exe ^
  -lwinhttp -lbcrypt -lshell32

if errorlevel 1 exit /b 1
echo [build] OK: update_manager/build/zcord-updater.exe
copy /Y config\update.json build\update.json >nul 2>&1
