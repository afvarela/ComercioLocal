@echo off
setlocal
cd /d "%~dp0"
echo.
echo ATENCION: se borraran usuarios, ventas, inventario, clientes y movimientos LOCALES.
echo Antes del borrado se creara un respaldo automatico.
echo.
set /p CONFIRMACION=Escriba BORRAR para continuar: 
if /I not "%CONFIRMACION%"=="BORRAR" (
  echo Operacion cancelada.
  pause
  exit /b 1
)
python "%~dp0scripts\reset-data.py" --confirm BORRAR
if errorlevel 1 (
  echo.
  echo No fue posible reiniciar la base local.
  pause
  exit /b 1
)
echo.
echo Reinicio local completado.
pause
