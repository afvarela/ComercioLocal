param([switch]$ImportarDatosLocales)
$ErrorActionPreference = 'Stop'
$Project = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Project
$Wrangler = Join-Path $Project 'node_modules\wrangler\wrangler-dist\cli.js'
$Node = 'C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
if (-not (Test-Path $Node)) { $Node = (Get-Command node -ErrorAction Stop).Source }
if (-not (Test-Path $Wrangler)) { throw 'Wrangler no está instalado en este proyecto.' }
function Invoke-Wrangler {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)
  & $Node $Wrangler @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Wrangler terminó con código $LASTEXITCODE." }
}

Write-Host '1/7 Construyendo la interfaz React...'
$Esbuild = Join-Path $Project 'node_modules\@esbuild\win32-x64\esbuild.exe'
if (-not (Test-Path $Esbuild)) { throw 'No se encontro esbuild. Ejecute npm install antes de publicar.' }
& $Esbuild 'src/main.jsx' '--bundle' '--outfile=public/app.js' '--format=iife' '--target=es2020' '--jsx=automatic' '--minify' '--define:process.env.NODE_ENV=\"production\"'
if ($LASTEXITCODE -ne 0) { throw "La compilacion termino con codigo $LASTEXITCODE." }
$ServiceWorker = Join-Path $Project 'public\sw.js'
$CacheVersion = 'comercio-local-' + (Get-Date -Format 'yyyyMMddHHmmss')
$ServiceWorkerText = [IO.File]::ReadAllText($ServiceWorker)
$ServiceWorkerText = [regex]::Replace($ServiceWorkerText, 'comercio-local-[A-Za-z0-9-]+', $CacheVersion, 1)
[IO.File]::WriteAllText($ServiceWorker, $ServiceWorkerText, [Text.UTF8Encoding]::new($false))

Write-Host '2/7 Ejecutando pruebas unitarias...'
& $Node --test --test-isolation=none tests/payments.test.mjs tests/customers.test.mjs tests/cloud-worker.test.mjs tests/logistics-cloud.test.mjs tests/offline.test.mjs tests/format.test.mjs
if ($LASTEXITCODE -ne 0) { throw "Las pruebas unitarias terminaron con codigo $LASTEXITCODE." }
& python -m unittest discover -s tests -p 'test_*.py'
if ($LASTEXITCODE -ne 0) { throw "Las pruebas Python terminaron con codigo $LASTEXITCODE. No se publico nada." }

Write-Host "Node utilizado: $(& $Node --version)"
Write-Host '3/7 Verificando la cuenta de Cloudflare...'
& $Node $Wrangler whoami
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Wrangler no pudo iniciar. Se usara el publicador directo de Cloudflare...' -ForegroundColor Yellow
  $env:COMERCIO_NODE = $Node
  & python scripts\deploy-cloudflare-api.py
  if ($LASTEXITCODE -ne 0) { throw "El publicador directo termino con codigo $LASTEXITCODE." }
  $PublicUrl = [IO.File]::ReadAllText((Join-Path $Project 'cloudflare\deployment-url.txt')).Trim()
  & $Node (Join-Path $Project 'scripts\check-deployment.mjs') $PublicUrl '3.3.2'
  if ($LASTEXITCODE -ne 0) { throw "La aplicacion publicada en $PublicUrl no paso la verificacion." }
  Write-Host "Publicacion verificada: $PublicUrl" -ForegroundColor Green
  exit 0
}

Write-Host '4/7 Aplicando migraciones de D1...'
Invoke-Wrangler d1 migrations apply comercio-local --remote --config cloudflare/wrangler.jsonc
$ImportMarker = Join-Path $Project 'data\.cloud-imported'
if ($ImportarDatosLocales -and -not (Test-Path $ImportMarker)) {
  python scripts\export-d1.py
  Invoke-Wrangler d1 execute comercio-local --remote --file cloudflare/local-data.sql --config cloudflare/wrangler.jsonc
  Set-Content -LiteralPath $ImportMarker -Value (Get-Date -Format o)
} else {
  Write-Host 'Se conserva la información actual de D1. No se importan datos locales automáticamente.'
}

Write-Host '5/7 Subiendo imágenes de productos a R2...'
$ImagesMarker = Join-Path $Project 'data\.cloud-images-uploaded'
if (-not (Test-Path $ImagesMarker)) {
  Get-ChildItem public\images -File | ForEach-Object {
    $key = 'products/' + $_.Name
    Invoke-Wrangler r2 object put "comercio-local-imagenes/$key" --file $_.FullName --remote --config cloudflare/wrangler.jsonc
  }
  Set-Content -LiteralPath $ImagesMarker -Value (Get-Date -Format o)
} else {
  Write-Host 'Las imagenes ya estan en R2; se omite la carga repetida.'
}

Write-Host '6/7 Publicando Worker y archivos web...'
function Publish-Worker {
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $Node $Wrangler deploy --config cloudflare/wrangler.jsonc 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  $output | ForEach-Object { Write-Host $_ }
  if ($exitCode -ne 0) { throw "Wrangler termino con codigo $exitCode durante la publicacion." }
  $match = [regex]::Match(($output | Out-String), 'https://[A-Za-z0-9.-]+\.workers\.dev')
  if (-not $match.Success) { throw 'Cloudflare no devolvio una URL publica para verificar.' }
  return $match.Value
}
function Publish-Direct {
  Write-Host 'Wrangler no pudo publicar. Se usara el publicador directo de Cloudflare...' -ForegroundColor Yellow
  $env:COMERCIO_NODE = $Node
  & python scripts\deploy-cloudflare-api.py
  if ($LASTEXITCODE -ne 0) { throw "El publicador directo termino con codigo $LASTEXITCODE." }
  return [IO.File]::ReadAllText((Join-Path $Project 'cloudflare\deployment-url.txt')).Trim()
}
try {
  $PublicUrl = Publish-Worker
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Yellow
  $PublicUrl = Publish-Direct
}

Write-Host '7/7 Verificando la aplicacion publicada...'
& $Node (Join-Path $Project 'scripts\check-deployment.mjs') $PublicUrl '3.3.2'
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Cloudflare sigue respondiendo con la version anterior. Se repetira el despliegue del Worker...' -ForegroundColor Yellow
  $PublicUrl = Publish-Worker
  & $Node (Join-Path $Project 'scripts\check-deployment.mjs') $PublicUrl '3.3.2'
  if ($LASTEXITCODE -ne 0) { throw "La aplicacion publicada en $PublicUrl no paso la verificacion despues de dos despliegues." }
}
[IO.File]::WriteAllText((Join-Path $Project 'cloudflare\deployment-url.txt'), $PublicUrl, [Text.UTF8Encoding]::new($false))
Write-Host "Publicacion verificada: $PublicUrl" -ForegroundColor Green



