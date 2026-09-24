@echo off
title Zcord Independent
cd /d "%~dp0.."
echo Lancement Zcord independant (pas Discord officiel)...
call npx --yes pnpm@10.30.3 exec tsx scripts/build/buildDesktop.mts --dev
if errorlevel 1 exit /b 1
call npx --yes pnpm@10.30.3 run buildStandalone:dev
if errorlevel 1 exit /b 1
node scripts\start-independent.cjs
