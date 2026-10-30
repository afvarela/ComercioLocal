$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project
$env:WRANGLER_LOG_PATH = Join-Path $Project 'logs\wrangler'
New-Item -ItemType Directory -Force -Path $env:WRANGLER_LOG_PATH | Out-Null
$Excel = Join-Path $Project 'importaciones\INVENTARIO TIENDA EL DESCANSO.xlsx'
$Sql = Join-Path $Project 'tmp\import-inventory-d1.sql'
$Node = 'C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path $Node)) { $Node = (Get-Command node -ErrorAction Stop).Source }
$Wrangler = Join-Path $Project 'node_modules\wrangler\wrangler-dist\cli.js'
if (-not (Test-Path $Wrangler)) {
    throw 'Wrangler no esta instalado. Ejecute npm install.'
}
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

Write-Host 'Se importara en D1 el Supermercado/Tienda El Descanso.' -ForegroundColor Yellow
Write-Host 'La ferreteria no sera modificada.'
$Answer = Read-Host 'Escriba IMPORTAR para continuar'
if ($Answer -cne 'IMPORTAR') { throw 'Operacion cancelada.' }

$BackupFolder = Join-Path $Project 'backups\d1'
New-Item -ItemType Directory -Force -Path $BackupFolder | Out-Null
$Backup = Join-Path $BackupFolder ("comercio-local-antes-inventario-{0}.sql" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

Write-Host '1/5 Exportando respaldo de D1...'
& $Node $Wrangler d1 export comercio-local --remote --output $Backup --config cloudflare/wrangler.jsonc
if ($LASTEXITCODE -ne 0) { throw 'No se creo el respaldo. No se modifico D1.' }

Write-Host '2/5 Verificando que la importacion anterior no tenga ventas...'
$Query = "SELECT (SELECT COUNT(*) FROM sale_lines WHERE product_id IN (SELECT id FROM products WHERE business_id=1 AND sku LIKE 'TDESC-%')) + (SELECT COUNT(*) FROM purchase_lines WHERE product_id IN (SELECT id FROM products WHERE business_id=1 AND sku LIKE 'TDESC-%')) used"
$CheckRaw = & $Node $Wrangler d1 execute comercio-local --remote --command $Query --json --config cloudflare/wrangler.jsonc
if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar D1.' }
$Check = $CheckRaw | ConvertFrom-Json
$Used = [int]$Check[0].results[0].used
if ($Used -gt 0) {
    throw 'La importacion anterior ya tiene ventas o compras. Reinicie los datos de prueba antes de reemplazarla.'
}

Write-Host '3/5 Generando SQL compatible con D1...'
& $Python @PythonArgs (Join-Path $Project 'scripts\import_inventory.py') --target sql --file $Excel --output $Sql --confirm IMPORTAR
if ($LASTEXITCODE -ne 0) { throw 'No se pudo leer el archivo Excel.' }

Write-Host '4/5 Importando maestro e inventario en D1...'
& $Node $Wrangler d1 execute comercio-local --remote --file $Sql --config cloudflare/wrangler.jsonc
if ($LASTEXITCODE -ne 0) { throw "D1 no pudo importar. Respaldo: $Backup" }

Write-Host '5/5 Verificando cantidades importadas...'
$VerifyQuery = "SELECT (SELECT COUNT(*) FROM products WHERE business_id=1 AND active=1 AND sku LIKE 'TDESC-%') products, (SELECT COUNT(*) FROM lots WHERE business_id=1 AND code LIKE 'TDESC-IMPORT-%') lots, (SELECT COUNT(*) FROM stock_moves WHERE business_id=1 AND reference LIKE 'TDESC-IMPORT-%') movements"
$VerifyRaw = & $Node $Wrangler d1 execute comercio-local --remote --command $VerifyQuery --json --config cloudflare/wrangler.jsonc
if ($LASTEXITCODE -ne 0) { throw 'La carga termino, pero no se pudo verificar D1.' }
$Verify = $VerifyRaw | ConvertFrom-Json
$Products = [int]$Verify[0].results[0].products
$Lots = [int]$Verify[0].results[0].lots
$Movements = [int]$Verify[0].results[0].movements
if ($Products -lt 1 -or $Lots -ne $Movements) {
    throw "Verificacion inesperada: productos=$Products, lotes=$Lots, movimientos=$Movements"
}
Write-Host "Importacion remota completada: $Products productos, $Lots lotes y $Movements movimientos." -ForegroundColor Green
Write-Host "Respaldo: $Backup"
