@echo off
echo Iniciando TikRace...
start cmd /k "cd /d C:\Users\juand\Documents\tikjuego && node server.js"
timeout /t 3 /nobreak > nul
start chrome --app=http://localhost:3000 --window-size=480,854 --window-position=100,50
