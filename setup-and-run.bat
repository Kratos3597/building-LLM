@echo off
setlocal enabledelayedexpansion
title CloudNex Local LLM Studio - 1-Click Zero Setup
color 0B

echo.
echo  ========================================================================
echo    CLOUDNEX LOCAL LLM STUDIO - AUTOMATED SETUP ^& RUNTIME LAUNCHER
echo    Created by Mohammed Sheik ^| https://cloudnex.co.za
echo    100%% Sovereign ^& On-Device Post-Training Architecture
echo  ========================================================================
echo.

:: 1. CHECK NODE.JS
echo  [1/4] Checking Node.js runtime environment...
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo  [!] Node.js was not found on your system PATH.
    echo      Please download and install Node.js 18+ or 20+ LTS from:
    echo      https://nodejs.org/
    echo.
    pause
    exit /b 1
)
node -v
echo      Node.js runtime OK.

:: 2. INSTALL OR VERIFY NPM DEPENDENCIES
echo.
echo  [2/4] Verifying application dependencies...
if not exist "node_modules\" (
    echo      First-time setup detected.
    echo      Installing all required Node ^& Electron dependencies from package.json...
    echo      This only runs once and keeps your zip package ultra-lightweight.
    call npm install --no-audit --fund=false
    if %errorlevel% neq 0 (
        echo.
        echo  [X] Failed to install Node dependencies. Please check your internet connection.
        pause
        exit /b 1
    )
    echo      All Node dependencies installed successfully!
) else (
    echo      Existing dependencies found. Ready to boot.
)

:: 3. PYTHON / PIP ENVIRONMENT (OPTIONAL LOCAL ENGINE)
echo.
echo  [3/4] Checking Python backend engine for local LoRA/DPO training...
where python >nul 2>nul
if %errorlevel% equ 0 (
    echo      Python detected on system PATH.
    if not exist "venv\" (
        echo      Setting up clean Python virtual environment (venv)...
        python -m venv venv
    )
    if exist "requirements.txt" (
        echo      Verifying PyTorch and machine learning dependencies...
        call venv\Scripts\python -m pip install -q -r requirements.txt 2>nul
    )
    echo      Python AI runtime prepared.
) else (
    echo      Notice: Python not detected. Running in standard Web/Electron Studio mode.
    echo      (For hardware LoRA/DPO training, install Python 3.10+ and ROCm/CUDA).
)

:: 4. LAUNCH APPLICATION
echo.
echo  ========================================================================
echo    Starting CloudNex Local LLM Studio...
echo    Port: 3000 (HTTP ^& WebSocket Server)
echo  ========================================================================
echo.

start "" http://localhost:3000
call npm start

pause
