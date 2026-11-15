@echo off
chcp 65001 >nul
title 启动公网部署栈 (A_Medical_DATA)
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-deploy-all.ps1" %*
echo.
pause
