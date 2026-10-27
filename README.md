# ComercioLocal

Sistema de punto de venta para **Mini market** y **Ferreteria**, construido con React, Python/SQLite y Cloudflare Workers con D1 y R2.

Incluye ventas POS, operacion sin conexion, inventario por lotes, caja, fiados, cotizaciones, facturas carta PDF, despachos, etiquetas, reportes y contabilidad.

## Inicio local

```powershell
npm install
npm start
```

La aplicacion queda disponible en `http://127.0.0.1:8765/`.

## Pruebas

```powershell
npm test
python -m unittest discover -s tests -p "test_*.py"
```

## Publicacion

Ejecute `PUBLICAR-CLOUDFLARE.cmd`. La configuracion se encuentra en `cloudflare/wrangler.jsonc`.

## Reinicio de datos

- `BORRAR-DATOS-PRUEBA-LOCAL.cmd`: respalda y limpia SQLite local.
- `BORRAR-DATOS-PRUEBA-CLOUD.cmd`: exporta un respaldo y limpia D1 en produccion.

Los dos procesos requieren una confirmacion explicita. Consulte [LEEME.md](LEEME.md) para la documentacion completa.
