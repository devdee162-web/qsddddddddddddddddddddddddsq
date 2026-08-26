@echo off
:: Wrapper .bat pour lancer zcord-install.ps1 facilement (double-clic)
title Zcord — Installation
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0zcord-install.ps1"
if %errorlevel% neq 0 pause
