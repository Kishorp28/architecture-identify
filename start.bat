@echo off
title Antigravity - AI Architecture Assistant
color 0B

echo.
echo  ==========================================
echo   Antigravity - AI Architecture Assistant
echo  ==========================================
echo.

:: Check if venv exists
if not exist "backend\venv\Scripts\python.exe" (
    echo  [ERROR] Virtual environment not found at backend\venv
    echo  Please create it first with:
    echo    cd backend
    echo    python -m venv venv
    echo    venv\Scripts\pip install -r requirements.txt
    pause
    exit /b 1
)

echo  [1/2] Starting backend server on http://127.0.0.1:8000 ...
start "Antigravity Backend" cmd /k "title Antigravity Backend && color 0A && backend\venv\Scripts\python run.py"

:: Small delay so backend can bind the port before frontend starts
timeout /t 3 /nobreak > nul

echo  [2/2] Starting frontend on http://localhost:5173 ...
start "Antigravity Frontend" cmd /k "title Antigravity Frontend && color 0B && cd frontend && npm run dev"

echo.
echo  Both servers are starting in separate windows.
echo.
echo  Open your browser at: http://localhost:5173
echo.
pause
