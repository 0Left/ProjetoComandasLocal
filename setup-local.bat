@echo off
chcp 65001 >nul
cd /d "%~dp0"

set "LOCAL=config\local"
set "EX=config\examples"
set NEED=0

if not exist "%LOCAL%" mkdir "%LOCAL%"

if not exist "%LOCAL%\supabase-env.mjs" (
  copy /Y "%EX%\supabase-env.mjs.example" "%LOCAL%\supabase-env.mjs" >nul
  echo [OK] Criado %LOCAL%\supabase-env.mjs — edite com as chaves do Projeto A.
  set NEED=1
)

if not exist "%LOCAL%\catalogo-env.mjs" (
  copy /Y "%EX%\catalogo-env.mjs.example" "%LOCAL%\catalogo-env.mjs" >nul
  echo [OK] Criado %LOCAL%\catalogo-env.mjs — edite com as chaves do Projeto B.
  set NEED=1
)

if %NEED%==1 (
  echo.
  echo Preencha os arquivos em config\local\ antes de usar o app.
  exit /b 1
)

echo Config local OK — config\local\ supabase-env.mjs e catalogo-env.mjs encontrados.
exit /b 0
