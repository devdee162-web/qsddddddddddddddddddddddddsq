@echo off
:: Wrapper .bat pour lancer zcord-uninstall.ps1 facilement (double-clic)
title Zcord — Désinstallation
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0zcord-uninstall.ps1"
if %errorlevel% neq 0 pause
