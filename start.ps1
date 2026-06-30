# start.ps1 — starts backend + frontend in two new terminal windows
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "Starting Antigravity Backend..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; .\backend\venv\Scripts\python run.py"

Start-Sleep -Seconds 2

Write-Host "Starting Antigravity Frontend..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\frontend'; npm run dev"

Write-Host ""
Write-Host "Both servers are starting." -ForegroundColor Green
Write-Host "Frontend: http://localhost:5173" -ForegroundColor Green
Write-Host "Backend:  http://127.0.0.1:8000" -ForegroundColor Green
