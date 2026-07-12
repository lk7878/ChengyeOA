@echo off
chcp 65001 >nul
echo ========================================
echo  Building Law Firm System Installer
echo  律所管理系统 安装程序构建
echo ========================================
echo.

REM Check for Inno Setup compiler
where iscc >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Inno Setup Compiler (iscc) not found in PATH.
    echo Please install Inno Setup from: https://jrsoftware.org/isinfo.php
    echo.
    echo Or add it to your PATH (e.g. C:\Program Files (x86)\Inno Setup 6\)
    echo.
    pause
    exit /b 1
)

echo [1/2] Packaging application...
echo Running: cd apps\server && node scripts\build-package.js
echo.

cd /d "%~dp0..\apps\server"
call node scripts\build-package.js
if %errorlevel% neq 0 (
    echo ERROR: Package build failed.
    pause
    exit /b 1
)

cd /d "%~dp0"
echo.
echo [2/2] Building installer...
echo Running: iscc installer.iss
echo.

iscc "%~dp0installer.iss"
if %errorlevel% neq 0 (
    echo ERROR: Installer build failed.
    pause
    exit /b 1
)

echo.
echo ========================================
echo  Installer build complete!
echo  Output: apps\dist\installer\
echo ========================================
echo.
pause
