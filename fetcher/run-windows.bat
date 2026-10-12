@echo off
REM Double-clique sur ce fichier pour recuperer tes donnees Garmin (Windows).
cd /d "%~dp0"

echo === RunLab - preparation ===

REM Trouve Python
set PY=
where python >nul 2>nul && set PY=python
if "%PY%"=="" where py >nul 2>nul && set PY=py
if "%PY%"=="" (
  echo [!] Python n'est pas installe.
  echo     Installe-le depuis https://www.python.org/downloads/
  echo     IMPORTANT : coche "Add Python to PATH" pendant l'installation, puis relance.
  pause
  exit /b 1
)

REM Environnement isole + dependances (uniquement la 1re fois)
if not exist ".venv" (
  echo Installation (une seule fois, peut prendre 1-2 min)...
  %PY% -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -r requirements.txt

echo.
python fetch_garmin.py

echo.
pause
