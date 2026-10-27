@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel% equ 0 (
  py -3 server.py
  pause
  exit /b
)
if exist "%LOCALAPPDATA%\..\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  "%LOCALAPPDATA%\..\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" server.py
  pause
  exit /b
)
if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
  "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" server.py
  pause
  exit /b
)
echo Instala Python 3.11 o superior y vuelve a abrir este archivo.
echo Luego abre http://127.0.0.1:8765 en el navegador.
pause
