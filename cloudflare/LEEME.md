# Publicación en Cloudflare — estado actualizado

El proyecto ya tiene Worker, D1, R2, migraciones, adaptación de la API y venta sin internet con sincronización. `PUBLICAR-CLOUDFLARE.ps1` aplica las migraciones, importa una sola vez los datos locales, carga las imágenes a R2 y publica React junto con el Worker. Las publicaciones siguientes preservan los datos actuales de D1 mediante `data/.cloud-imported`.

```powershell
cd "C:\Users\User\Documents\Codex\2026-09-16\necesito-hacer-un-desarrollo-que-sea\outputs\ComercioLocal"
.\PUBLICAR-CLOUDFLARE.ps1
```

Wrangler muestra la URL pública al finalizar. El SMTP local usa `.env`; para enviar correo desde Workers todavía se necesita guardar de forma segura la credencial de un proveedor de correo por API.

## Registro anterior de preparación

La cuenta está conectada mediante el complemento Cloudflare de Codex. No hay claves en estos archivos.

## Configurado

- D1 `comercio-local`, identificador en `resources.json`.
- Estructura inicial aplicada desde `migrations/0001_initial.sql` con separación por negocio.
- Columnas de precio por libra/gramos, imagen, costo por lote y base de precio histórica incluidas.

## Pendiente

1. Activar R2 desde el panel de Cloudflare. La API devuelve el error 10042 hasta completar ese paso.
2. Crear el bucket privado `comercio-local-imagenes` y cargar las fotografías con sus atribuciones.
3. Adaptar el backend Python/SQLite a Workers/D1 con transacciones e idempotencia equivalentes y acceso autenticado a R2.
4. Implementar y probar sincronización de ventas sin internet antes de sustituir el servidor local. Mantener dos bases independientes sin sincronización no cumple ese requisito.
5. Respaldar e importar los datos locales, sin publicar sesiones de acceso existentes.
6. Publicar el frontend React junto con la API y verificar ventas, fiados, caja, inventario, reportes e imágenes.

No hay todavía una aplicación publicada ni sincronización con D1. El sistema local sigue usando `data/comercio.sqlite3`; no se modificó ni se reemplazó esa base. D1 tiene únicamente la estructura y los dos negocios iniciales, sin usuarios ni ventas reales.

No ejecutar de nuevo la migración inicial sobre una base existente para actualizarla: las siguientes modificaciones deberán tener migraciones numeradas propias.
