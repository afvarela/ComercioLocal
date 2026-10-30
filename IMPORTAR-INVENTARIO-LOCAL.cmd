@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\import-inventory-local.ps1"
if errorlevel 1 (
  echo.
  echo La importacion local no termino. Revisa el error mostrado arriba.
  pause
  exit /b 1
)
echo.
echo Importacion local completada.
pause
