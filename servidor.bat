@echo off
chcp 65001 >nul
title Comandas — servidor local
cd /d "%~dp0"

call setup-local.bat
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)

set PORT=8080
echo.
echo  Comandas — servidor estático
echo  Pasta: %cd%
echo  Comandas:  http://localhost:%PORT%/
echo  Cardápio:  http://localhost:%PORT%/cardapio.html
echo  (Ctrl+C para encerrar)
echo.

where python >nul 2>&1
if %errorlevel%==0 (
  python -m http.server %PORT%
  goto fim
)

where py >nul 2>&1
if %errorlevel%==0 (
  py -3 -m http.server %PORT%
  goto fim
)

echo [ERRO] Python nao encontrado. Instale Python 3 e marque "Add to PATH", ou use a Microsoft Store.
echo.
pause
exit /b 1

:fim
if %errorlevel% neq 0 (
  echo.
  echo Servidor encerrado com codigo %errorlevel%.
  pause
)
