$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project
$Excel = Join-Path $Project 'importaciones\INVENTARIO TIENDA EL DESCANSO.xlsx'
if (-not (Test-Path -LiteralPath $Excel)) {
    throw "No se encontro el archivo. Copielo en: $Excel"
}

$Python = $null
$PythonArgs = @()
$Bundled = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
if (Test-Path $Bundled) {
    $Python = $Bundled
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    $Python = (Get-Command python).Source
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    $Python = (Get-Command py).Source
    $PythonArgs = @('-3')
}
if (-not $Python) { throw 'Instale Python 3.11 o superior.' }

& $Python @PythonArgs -c "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('openpyxl') else 1)"
if ($LASTEXITCODE -ne 0) {
    Write-Host 'Instalando la dependencia para leer Excel...'
    & $Python @PythonArgs -m pip install -r (Join-Path $Project 'requirements.txt')
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar openpyxl.' }
}

Write-Host 'Se reemplazara solamente la importacion anterior con SKU TDESC-.' -ForegroundColor Yellow
Write-Host 'No se borran productos manuales ni datos de la ferreteria.'
$Answer = Read-Host 'Escriba IMPORTAR para continuar'
if ($Answer -cne 'IMPORTAR') { throw 'Operacion cancelada.' }

& $Python @PythonArgs (Join-Path $Project 'scripts\import_inventory.py') --target local --file $Excel --confirm IMPORTAR
if ($LASTEXITCODE -ne 0) { throw 'No se pudo importar el inventario local.' }
Write-Host 'Importacion local terminada. Actualice Punto de venta.' -ForegroundColor Green
