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

echo [1/2] Packaging and verifying application...
echo Running: npm.cmd run pkg
echo.

pushd "%~dp0.."
call npm.cmd run pkg
if %errorlevel% neq 0 (
    echo ERROR: Package build failed.
    popd
    exit /b 1
)
call node.exe "%~dp0verify-package-output.js" "%~dp0..\apps\dist\law-firm-system"
if %errorlevel% neq 0 (
    echo ERROR: Package output verification failed.
    popd
    exit /b 1
)
popd

echo.
echo [2/2] Building installer...
echo Running: iscc installer.iss
echo.

iscc "%~dp0installer.iss"
if %errorlevel% neq 0 (
    echo ERROR: Installer build failed.
    exit /b 1
)

echo.
echo ========================================
echo  Installer build complete!
echo  Output: apps\dist\installer\
echo ========================================
echo.
