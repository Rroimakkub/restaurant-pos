@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo ไม่พบ Node.js กรุณาติดตั้งจาก https://nodejs.org ^(เวอร์ชัน 22.13 ขึ้นไป^)
  pause
  exit /b 1
)
if not exist node_modules (
  echo กำลังติดตั้งครั้งแรก...
  call npm install --no-audit --no-fund
)
start "" http://localhost:3000
call npm start
pause
