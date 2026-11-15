@echo off
chcp 65001 >nul
title 一键启动公网部署
cd /d "E:\A"
echo.
echo  数据目录: E:\A_Medical_DATA
echo  公网地址: https://162.14.78.238:10443
echo  (本机 127.0.0.1:6180 只是隧道入口，请用上面的公网地址)
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "E:\A\start-deploy-all.ps1"
echo.
pause
