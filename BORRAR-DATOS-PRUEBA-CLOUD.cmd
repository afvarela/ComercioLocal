@echo off
setlocal
cd /d "%~dp0"
echo.
echo PELIGRO: este proceso borrara usuarios, ventas, inventario, clientes,
echo despachos y movimientos de la base PUBLICADA en Cloudflare D1.
echo NO se creara respaldo ni se exportara D1.
echo La estructura y los datos legales de los negocios se conservaran.
echo.
set /p CONFIRMACION=Escriba exactamente BORRAR PRODUCCION para continuar: 
if not "%CONFIRMACION%"=="BORRAR PRODUCCION" (
  echo Operacion cancelada.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\reset-cloud-data.ps1" -Confirmar
if errorlevel 1 (
  echo.
  echo El reinicio remoto no termino. Revise el error mostrado arriba.
  pause
  exit /b 1
)
echo.
echo Reinicio remoto completado.
pause
