@echo off
cd /d "%~dp0"
timeout /t 8 /nobreak >nul
:loop
node.exe index.js >> bot.log 2>&1
timeout /t 5 /nobreak >nul
goto loop
