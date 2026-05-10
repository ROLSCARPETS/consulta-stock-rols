@echo off
chcp 65001 >nul
title Consulta de Stock - Rols Carpets

echo ============================================================
echo   Consulta de Stock - Rols Carpets
echo ============================================================
echo.

REM Cambiar al directorio del .bat y bajar a la carpeta del skill
cd /d "%~dp0consulta-stock-rols"

REM Verificar que Python esta disponible
where python >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Python no esta instalado o no esta en el PATH.
    echo.
    echo Instala Python desde https://www.python.org/downloads/
    echo Importante: durante la instalacion, marcar "Add Python to PATH".
    echo.
    pause
    exit /b 1
)

REM Verificar/instalar Flask
python -c "import flask" >nul 2>nul
if errorlevel 1 (
    echo [Primera vez] Instalando Flask...
    python -m pip install flask --quiet
    if errorlevel 1 (
        echo [ERROR] No se pudo instalar Flask.
        pause
        exit /b 1
    )
    echo Flask instalado.
    echo.
)

REM Verificar/instalar openpyxl (lo usa buscar_stock.py)
python -c "import openpyxl" >nul 2>nul
if errorlevel 1 (
    echo [Primera vez] Instalando openpyxl...
    python -m pip install openpyxl --quiet
    echo.
)

REM Verificar/instalar openai (lo usa intent_parser.py para la capa de IA)
python -c "import openai" >nul 2>nul
if errorlevel 1 (
    echo [Primera vez] Instalando openai...
    python -m pip install openai --quiet
    echo.
)

REM Verificar/instalar python-dotenv (carga .env con la OPENAI_API_KEY)
python -c "import dotenv" >nul 2>nul
if errorlevel 1 (
    echo [Primera vez] Instalando python-dotenv...
    python -m pip install python-dotenv --quiet
    echo.
)

REM Abrir el navegador en 3s (en paralelo al arranque del servidor)
start "" /min cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:5000"

echo Arrancando servidor en http://localhost:5000 ...
echo.
echo --- Para DETENER la app, cierra esta ventana o pulsa Ctrl+C ---
echo.

python app.py

REM Si el servidor cae, dejar la ventana abierta para ver el error
echo.
echo Servidor detenido.
pause
