param([switch]$Confirmar)
$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project
$Node = 'C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path $Node)) { $Node = (Get-Command node -ErrorAction Stop).Source }
$Wrangler = Join-Path $Project 'node_modules\wrangler\wrangler-dist\cli.js'
if (-not (Test-Path $Wrangler)) { throw 'Wrangler no esta instalado. Ejecute npm install.' }
if (-not $Confirmar) { throw 'Falta la confirmacion interna del archivo CMD.' }

$BackupFolder = Join-Path $Project 'backups\d1'
New-Item -ItemType Directory -Force -Path $BackupFolder | Out-Null
$Stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$Backup = Join-Path $BackupFolder "comercio-local-antes-borrado-$Stamp.sql"

Write-Host '1/3 Exportando respaldo de D1...'
& $Node $Wrangler d1 export comercio-local --remote --output $Backup --config cloudflare/wrangler.jsonc
if ($LASTEXITCODE -ne 0) { throw 'No se creo el respaldo. No se borro ningun dato.' }

Write-Host '2/3 Borrando datos de prueba de D1...'
& $Node $Wrangler d1 execute comercio-local --remote --file cloudflare/reset-test-data.sql --config cloudflare/wrangler.jsonc
if ($LASTEXITCODE -ne 0) { throw 'D1 no pudo ejecutar el reinicio.' }

Write-Host '3/3 Restaurando catalogo predeterminado de verduras...'
& $Node $Wrangler d1 execute comercio-local --remote --file cloudflare/migrations/0005_vegetable_catalog.sql --config cloudflare/wrangler.jsonc
if ($LASTEXITCODE -ne 0) { throw 'Se borraron los datos, pero no se restauro el catalogo de verduras.' }

Write-Host "Reinicio remoto completado. Respaldo: $Backup" -ForegroundColor Green
Write-Host 'Abra la aplicacion publicada y cree nuevamente el administrador con un PIN de cuatro numeros.'
