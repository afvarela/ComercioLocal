@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0PUBLICAR-CLOUDFLARE.ps1"
if errorlevel 1 (
  echo.
  echo La publicacion no termino. Revisa el error mostrado arriba.
  pause
  exit /b 1
)
echo.
echo Publicacion completada.
pause
