@echo off
title KukeBot Guard
cd /d "C:\Users\马到成功\Desktop\kuke-bot"
echo [%date% %time%] Guard started >> guard_log.txt

:loop
tasklist /fi "imagename eq node.exe" 2>nul | find /i "node.exe" >nul
if errorlevel 1 (
    echo [%date% %time%] Bot offline, starting... >> guard_log.txt
    start """ /b "node.exe" "index.js"
    echo [%date% %time%] Start command sent >> guard_log.txt
    timeout /t 15 /nobreak >nul
)
timeout /t 30 /nobreak >nul
goto loop
