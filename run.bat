@echo off
echo =========================================
echo       Starting Focus Room Servers
echo =========================================

echo.
echo Starting Backend Server on port 4000...
start "Focus Room - Server" cmd /k "cd /d "%~dp0server" && node index.js"

echo.
echo Starting Frontend Dev Server on port 5173...
start "Focus Room - Client" cmd /k "cd /d "%~dp0client" && npm run dev"

echo.
echo Waiting a few seconds for the servers to initialize...
timeout /t 4 /nobreak > nul

echo.
echo Opening Focus Room in your default browser...
start http://localhost:5173

echo.
echo Done! You can close this window now. The servers are running in the two new windows.
pause
