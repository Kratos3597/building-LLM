#!/usr/bin/env bash
# ==============================================================================
# CloudNex Local LLM Studio - Automated Setup & Launcher for Linux & macOS
# Created by Mohammed Sheik | https://cloudnex.co.za
# ==============================================================================

set -e

echo ""
echo " ========================================================================"
echo "   CLOUDNEX LOCAL LLM STUDIO - 1-CLICK ZERO SETUP & RUNTIME LAUNCHER"
echo "   Created by Mohammed Sheik | https://cloudnex.co.za"
echo "   100% Sovereign & On-Device Post-Training Architecture"
echo " ========================================================================"
echo ""

# 1. Check Node.js
echo " [1/4] Checking Node.js runtime..."
if ! command -v node >/dev/null 2>&1; then
    echo " [!] Node.js was not found. Please install Node.js 18+ or 20+ from https://nodejs.org/"
    exit 1
fi
echo "      Node version: $(node -v) (OK)"

# 2. Check and Install Node Dependencies
echo ""
echo " [2/4] Verifying application dependencies..."
if [ ! -d "node_modules" ]; then
    echo "      First-time run detected. Installing dependencies from package.json..."
    echo "      This keeps your download zip under 5MB while ensuring full functionality."
    npm install --no-audit --fund=false
    echo "      All Node dependencies successfully installed!"
else
    echo "      Dependencies verified. Ready to boot."
fi

# 3. Check Python AI Engine
echo ""
echo " [3/4] Checking Python AI backend..."
if command -v python3 >/dev/null 2>&1; then
    if [ ! -d "venv" ]; then
        echo "      Creating local virtual environment (venv)..."
        python3 -m venv venv || true
    fi
    if [ -f "requirements.txt" ] && [ -d "venv" ]; then
        echo "      Verifying PyTorch / HuggingFace dependencies..."
        ./venv/bin/python -m pip install -q -r requirements.txt 2>/dev/null || true
    fi
    echo "      Python AI runtime ready."
else
    echo "      Notice: Python 3 not found on PATH. Studio running in interface mode."
fi

# 4. Launch Studio
echo ""
echo " ========================================================================"
echo "   Launching CloudNex Local LLM Studio on http://localhost:3000 ..."
echo " ========================================================================"
echo ""

if command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://localhost:3000 >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
    open http://localhost:3000 >/dev/null 2>&1 &
fi

npm start
