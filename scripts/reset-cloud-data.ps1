param([switch]$Confirmar)
$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $PSScriptRoot
Set-Location $Project
$Node = 'C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path $Node)) { $Node = (Get-Command node -ErrorAction Stop).Source }
$Wrangler = Join-Path $Project 'node_modules\wrangler\wrangler-dist\cli.js'
if (-not (Test-Path $Wrangler)) { throw 'Wrangler no esta instalado. Ejecute npm install.' }
if (-not $Confirmar) { throw 'Falta la confirmacion interna del archivo CMD.' }

Write-Host '1/3 Aplicando migraciones pendientes de D1...'
& $Node $Wrangler d1 migrations apply comercio-local --remote --config cloudflare/wrangler.jsonc
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron aplicar las migraciones. No se inicio la limpieza.' }

Write-Host '2/3 Borrando directamente los datos de prueba de D1 (sin respaldo)...'
& $Node $Wrangler d1 execute comercio-local --remote --file cloudflare/reset-test-data.sql --config cloudflare/wrangler.jsonc
if ($LASTEXITCODE -ne 0) { throw 'D1 no pudo ejecutar el reinicio.' }

Write-Host '3/3 Restaurando catalogo predeterminado de verduras...'
& $Node $Wrangler d1 execute comercio-local --remote --file cloudflare/migrations/0005_vegetable_catalog.sql --config cloudflare/wrangler.jsonc
if ($LASTEXITCODE -ne 0) { throw 'Se borraron los datos, pero no se restauro el catalogo de verduras.' }

Write-Host 'Reinicio remoto completado sin crear respaldo.' -ForegroundColor Green
Write-Host 'Al abrir la aplicacion, cada equipo descartara automaticamente el catalogo local anterior.'
Write-Host 'Cree nuevamente el administrador con un PIN de cuatro numeros.'
