# Proyecto: Comercio Local

## Diseño de la solución

Un portal con dos ámbitos operativos identificados por `business_id`: 1 mini market y 2 ferretería. El selector cambia el ámbito visible, pero el servidor también valida la membresía del usuario y filtra cada operación por negocio. Referencias y códigos de barras pueden repetirse entre negocios; dentro de un negocio son únicos. Consecutivos de ventas independientes MM y FE. Clientes y cupos independientes.

Se usa un servidor local y SQLite como fuente de verdad. El navegador no contiene una copia autoritativa del inventario. Esto permite vender cuando se corta internet, sin reconciliar dos bases divergentes. No equivale a operar cuando se apaga o se desconecta el servidor local.

## Archivos

| Archivo | Responsabilidad |
|---|---|
| server.py | HTTP local, autenticación, autorización, operaciones y recibos |
| schema.sql | Tablas, índices, relaciones y restricciones |
| src/App.jsx | Aplicación React: navegación y coordinación |
| src/pages/PointOfSale.jsx | Búsqueda y carrito en React |
| src/components/Checkout.jsx | Cinco medios visibles y reparto automático |
| src/lib/payments.js | Cálculos puros de reparto y cambio |
| public/app.js | Bundle React generado; no editar manualmente |
| public/style.css | Interfaz adaptable y estilos |
| electronic.py | Contrato de proveedor futuro, actualmente desactivado |
| tests/test_store.py | Pruebas aisladas de los movimientos comerciales |
| INICIAR.cmd | Inicio en Windows |
| vegetables.json | Diez verduras con foto, precio pendiente y base de 500 g |
| FOTOS.md | Créditos de las fotografías de Wikimedia Commons |
| data/ | Base local y respaldos; no incluir en repositorios |

## Integridad de las operaciones

- Cada comando comercial se ejecuta dentro de `BEGIN IMMEDIATE` y se confirma como una unidad.
- La venta valida negocio, producto, cantidades, existencias utilizables, cliente, cupo y caja antes de escribir.
- Las cantidades de líneas repetidas se acumulan antes de asignar los lotes. Se impide vender varias veces el mismo saldo por líneas duplicadas.
- La asignación FEFO descuenta lotes y guarda las asignaciones originales en la línea.
- Dinero en centavos enteros; pesos en gramos; longitudes en milímetros. Se utiliza Decimal y redondeo HALF_UP por línea en servidor.
- `price_basis` permite 500 g por libra o 1.000 g por kilogramo. La base se conserva en cada línea de venta y `cost_basis` en cada lote; los cambios posteriores no reinterpretan costos históricos.
- Una clave de idempotencia por venta evita duplicados cuando se repite la misma solicitud después de un error de red. Los demás comandos no tienen idempotencia distribuida; la interfaz evita doble envío mientras están procesando.
- La anulación conserva la venta original, devuelve lotes, registra movimientos contrarios y anula la deuda; no borra el historial.
- El margen deriva de los costos de los lotes efectivamente consumidos.
- Consultas parametrizadas y restricciones de unicidad respaldan las validaciones.

## Modelo de información

Negocios → productos → lotes → movimientos de inventario. Negocios → clientes → ventas con saldo. Usuarios → sesiones de acceso. Negocios → sesiones de caja → pagos y entradas/retiros. Ventas → líneas → asignaciones de lote. Cotizaciones → venta convertida. Auditoría registra usuario, negocio, fecha, operación y datos sin contraseñas. La cola de correo persiste en la base.

## Facturación electrónica: etapa futura

La emisión no está implementada. No habilitar un interruptor ni simular aceptación. La interfaz `ElectronicProvider` describe tres operaciones: envío, consulta y nota crédito. `DisabledProvider` rechaza todas.

Una integración real debe contemplar:

1. Definir obligaciones y datos del emisor con su contador, elegir proveedor y confirmar si los negocios usan un mismo NIT o identidades distintas.
2. Modelar los datos tributarios del emisor y comprador: identificación y tipo, responsabilidades, municipio y dirección, entre otros según el documento y proveedor.
3. Modelar impuestos y tratamientos por producto; decidir precios incluidos/excluidos, descuentos y reglas de redondeo. Los precios actuales son importes finales de recibos internos y no contienen desglose tributario.
4. Registrar ambientes, credenciales, certificados cuando apliquen, prefijos y resoluciones/rangos autorizados. Separar numeración interna de numeración fiscal.
5. Implementar el adaptador al API oficial del proveedor con idempotencia, timeout, autenticación y validación del payload.
6. Incorporar estados persistentes: borrador, pendiente, enviado, resultado incierto, aceptado, rechazado y corrección. Ante timeout después de enviar, consultar antes de reintentar.
7. Guardar evidencias originales, CUFE cuando corresponda, XML y PDF recibidos, respuesta de validación y entrega al cliente. No generar códigos ficticios.
8. Diseñar notas crédito y devoluciones sin borrar documentos emitidos. Un reverso de caja no equivale a una nota crédito electrónica.
9. Implementar contingencia y transmisión posterior según el esquema vigente aplicable y el proveedor. No asumir que todo recibo offline puede transmitirse después sin requisitos.
10. Ejecutar habilitación y pruebas; activar únicamente con revisión del resultado. Nunca enviar automáticamente ventas históricas internas.

Fuentes consultadas para el diseño, 16 de septiembre de 2026:

- [Odoo: salida FEFO](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/shipping_receiving/removal_strategies/fefo.html): asignación de lotes por vencimiento.
- [Odoo: fechas de vencimiento](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/product_tracking/expiration_dates.html): control por lote y recepción.
- [DIAN: documento equivalente electrónico](https://micrositios.dian.gov.co/sistema-de-facturacion-electronica/documento-equivalente-electronico/): naturaleza del documento y sustitución de documentos equivalentes para quienes estén obligados.
- [DIAN: abecé POS electrónico](https://www.dian.gov.co/impuestos/factura-electronica/Documents/Abece-POS-Electronico-documento-equivalente.pdf): validación electrónica del documento POS.

## Validación y despliegue

Las pruebas automatizadas cubren separación de negocios, FEFO y bloqueo de vencidos, rollback por falta de stock, duplicados, pagos mixtos y cambio, cupo y abonos, cotización y conversión única, anulación, permisos de cajero y cierre con diferencias. Se ejecutan en bases temporales y no alteran la base del negocio.

Se comprobaron 13 escenarios del servidor y 8 de distribución de pagos. La revisión en navegador verificó ingreso, búsqueda por código con Enter, cantidad inicial de una unidad, apertura de cobro con Espacio, cinco medios visibles, disminución de efectivo al ingresar Nequi, fotos locales y cambio de verde a amarillo al pasar a ferretería. La impresora física y la entrega SMTP no están verificadas.

Antes de un despliegue permanente: probar impresora, recibos y peso con la operación real; confirmar recuperación de respaldos; configurar servicio y UPS; revisar roles y alcances; validar e-mail real. Para red local, usar HTTPS y un servidor gestionado adecuado. El servidor HTTP estándar entregado está limitado por defecto a loopback para esta prueba piloto. No hay hosting público ni acceso remoto configurados.

## Próximas mejoras operativas

Devoluciones parciales y posteriores a cierre con autorización y conciliación; edición/desactivación de usuarios; importación masiva de catálogo con revisión previa; compras y cuentas por pagar; conteos físicos con diferencias; costos de mermas en reportes; copias automáticas verificadas; instalación como servicio; integración ESC/POS según impresora; búsquedas y paginación para catálogos grandes; adaptador fiscal real. Cada una requiere implementación y pruebas adicionales, no está activada por esta documentación.
