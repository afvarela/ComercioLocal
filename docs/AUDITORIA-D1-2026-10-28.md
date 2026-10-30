# Auditoría y optimización de Cloudflare D1 — 28-10-2026

## Estado

Estos cambios están preparados y probados únicamente en local. No se desplegó el Worker ni se ejecutó la migración `0011_d1_read_optimization.sql` en producción.

## Hallazgo principal medido

La consulta anterior de `/api/state` devolvía 1.419 productos y ejecutaba dos subconsultas correlacionadas de lotes por producto. Cloudflare reportó `353.331 rows_read` en una sola llamada. Quince llamadas similares consumen aproximadamente 5,3 millones de filas, suficiente para superar el límite diario gratuito.

La interfaz repetía esa carga completa al iniciar, entrar al POS, vender, guardar una operación, cambiar de negocio y sincronizar. Además pedía `/api/history` simultáneamente aunque el operador estuviera únicamente facturando. No se encontró `setInterval` ni otro polling periódico; el problema era la repetición por eventos y la forma de la consulta.

## Cambios preparados

- El catálogo inicial se pagina con cursor estable, 30 productos por solicitud.
- El navegador conserva el catálogo en IndexedDB, con respaldo local para el modo sin conexión.
- `catalog_changes` y triggers aditivos registran qué productos cambiaron cuando se modifica un producto o un lote.
- Las sincronizaciones posteriores descargan solo los productos modificados o eliminados desde el último cursor.
- El POS solicita estado operativo sin catálogo, lotes ni clientes agregados en cada venta.
- Los clientes se recargan al iniciar, cambiar de negocio o abrir Clientes/Fiadores; la validación final del cupo sigue ocurriendo dentro de la transacción de venta.
- Los lotes detallados se cargan únicamente al abrir Inventario.
- El historial se carga únicamente en pantallas que lo necesitan.
- Las fechas de historial y reportes se convierten a límites UTC de Colombia antes de consultar, permitiendo usar índices sobre `created`.
- Se añadieron índices para catálogo, nombre, categoría, cambios incrementales, pagos, movimientos, auditoría, líneas de venta y relaciones usadas con frecuencia.
- Cada consulta D1 puede registrar `meta.rows_read`, `meta.rows_written`, duración, ruta y SQL normalizado. No registra parámetros, PIN, clientes ni otros valores sensibles.

## Comparación local reproducible

El comando `python scripts/audit-d1.py` trabaja sobre una copia temporal y nunca modifica la base indicada. En la copia local con 1.422 productos y 253 lotes produjo:

| Consulta | Resultado | Tiempo promedio local | Plan relevante |
|---|---:|---:|---|
| Anterior, catálogo completo | 1.421 productos | 38–44 ms | 2 subconsultas correlacionadas y 2 recorridos de lotes por producto |
| Compatibilidad optimizada, catálogo completo | 1.421 productos | 6,5–7,2 ms | índice de productos + búsqueda indexada de lotes |
| Página inicial nueva | 30 productos | 0,25–0,27 ms | cursor por `id` + lotes solo de esos 30 |
| Sincronización incremental | solo cambios | depende de cambios | `idx_catalog_changes_business_id (business_id, id>?)` |

El valor anterior de D1 (`353.331 rows_read`) es una medición real. Los tiempos y planes posteriores son mediciones locales. El valor posterior exacto de `rows_read` debe obtenerse después de un despliegue autorizado porque el límite actual bloquea consultas y no se modificó producción.

## Presupuesto esperado

Con 80 ventas diarias, el flujo normal deja de descargar 1.500 productos y el historial en cada venta. Cada venta debería consultar el estado pequeño de caja/permisos y sincronizar uno o pocos productos afectados. Incluso permitiendo varios cientos de filas por operación, el objetivo de menos de 500.000 lecturas diarias es razonable; debe confirmarse con los metadatos reales durante el primer día posterior al despliegue.

## Verificación posterior a una autorización de despliegue

1. Crear respaldo D1 antes de la migración.
2. Aplicar `0011_d1_read_optimization.sql`.
3. Desplegar el Worker y la interfaz.
4. Activar temporalmente `D1_METRICS=1` para registrar todas las consultas.
5. Abrir el POS una vez, vender un producto, volver al POS y abrir Ventas/Reportes una vez.
6. Revisar logs `d1_query` y `d1_request`; comparar especialmente `/api/state`, `/api/catalog`, `/api/history` y `/api/analytics`.
7. Confirmar que la primera sincronización usa páginas de 30 y las siguientes usan `since=<cursor>`.
8. Desactivar el detalle de métricas cuando termine la observación; las consultas que superen 5.000 lecturas continúan registrándose automáticamente.

## Archivos principales

- `cloudflare/read.mjs`: catálogo paginado/incremental y consultas por rango indexable.
- `cloudflare/store.mjs`: instrumentación D1 y metadatos.
- `cloudflare/migrations/0011_d1_read_optimization.sql`: tabla de cambios, triggers e índices.
- `src/lib/catalog.js`: IndexedDB, cursores y combinación incremental.
- `src/App.jsx`: cargas separadas por pantalla.
- `scripts/audit-d1.py`: auditoría reproducible sobre copia temporal.
- `tests/d1-optimization.test.mjs`: regresiones de consumo.
