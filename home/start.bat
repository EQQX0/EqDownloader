@echo off
rem EqDownload Home: runs the website on this PC. Double-click, then open http://localhost:8765
rem Run "start.bat --lan" to reach it from a phone on your Wi-Fi.
cd /d "%~dp0"
if not exist .venv (python -m venv .venv || (echo Python 3.10 or newer is required. & pause & exit /b 1))
.venv\Scripts\python -m pip install -q --upgrade yt-dlp
.venv\Scripts\python server.py %*
pause
