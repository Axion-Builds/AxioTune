@echo off
cd /d "%~dp0"
start "" "http://localhost:10000"
python backend.py
