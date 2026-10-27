@echo off
setlocal
cd /d "%~dp0"
python "%~dp0scripts\reset-local-admin.py"
if errorlevel 1 (
  echo.
  echo No fue posible reiniciar el usuario local.
  pause
  exit /b 1
)
echo.
echo Reinicio completado. Abra la aplicacion y cree el administrador.
pause
