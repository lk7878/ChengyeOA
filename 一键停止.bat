@echo off
chcp 65001 >nul
title Baiyou Zhiye - Stop All
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-all.ps1" -Stop
echo.
pause
