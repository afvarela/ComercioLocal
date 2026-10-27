# Comercio Local

## Estado actualizado

El sistema incluye cartera de fiados con movimientos, abonos y saldos; costo promedio ponderado; compras por lote; devoluciones de compra y venta; cotizaciones profesionales en PDF; recibos POS mediante el agente local; cola de correo SMTP; reportes en español; catálogo ampliado de verduras; y ventas sin internet guardadas en el navegador para sincronización automática. La versión web usa React y JavaScript, el servicio local usa Python con SQLite y la publicación usa Cloudflare Workers con D1 y R2.

Para impresión automática ejecuta también `INICIAR-IMPRESORA.cmd` y selecciona la impresora desde Configuración. Para correo copia `.env.example` como `.env` y completa los datos SMTP de tu proveedor. Las claves SMTP no vienen incluidas en el proyecto.

La publicación inicial se ejecuta con `PUBLICAR-CLOUDFLARE.ps1`. Importa una sola vez la base local a D1 y crea `data/.cloud-imported`; las publicaciones siguientes preservan los datos actuales de la nube.

Portal local para un mini market y una ferretería. Primera versión funcional para pruebas de operación. Los datos, las cajas, los consecutivos, las ventas y las existencias de cada negocio se mantienen separados.

## Abrir el proyecto

1. Abre `INICIAR.cmd` en Windows. Mantén esa ventana abierta mientras trabajas.
2. En el navegador entra a **http://127.0.0.1:8765/**.
3. La primera vez crea tu usuario administrador y una contraseña de al menos diez caracteres. No hay contraseñas predeterminadas.
4. En **Configuración**, registra los datos de cada negocio y el ancho de tu impresora: 58 u 80 mm.

Se necesita Python 3.11 o superior. En este computador el iniciador también detecta el Python incluido con Codex. En otro equipo instala Python antes de ejecutar el proyecto. La interfaz React ya está compilada: para operar no se necesitan paquetes adicionales ni internet. Las fotografías y bibliotecas se entregan como archivos locales.

Si el servidor ya está funcionando, abre directamente el enlace. No inicies dos servidores en el mismo puerto. Para detenerlo usa Ctrl+C en su ventana. Puedes cerrar el navegador sin borrar los datos.

## Empezar a operar

1. Selecciona Mini market o Ferretería en la parte superior.
2. En **Inventario → Nuevo producto**, registra referencia, nombre, precio y unidad. El código de barras es opcional. Marca los perecederos.
3. En **Recibir mercancía**, registra producto, cantidad, proveedor, lote, costo y vencimiento cuando aplique. Crear el producto no crea existencias.
4. En **Caja → Abrir caja**, registra el efectivo base y las observaciones. Se genera el recibo de apertura.
5. En **Punto de venta**, busca productos, agrega cantidades y cobra.
6. Al terminar la jornada, cuenta el efectivo y cierra la caja. Registra cualquier diferencia.
7. Descarga un respaldo desde Configuración y cópialo a otro dispositivo.

El mini market incluye diez verduras como catálogo inicial, con fotos ilustrativas, precio pendiente y existencias en cero. Asigna los precios y recibe mercancía antes de vender. Los demás productos y la ferretería se registran según tu negocio. Las pruebas automáticas y de pantalla usan bases separadas.

## Teclado y caja rápida

| Tecla | Función |
|---|---|
| F2 | Ir al buscador |
| Enter en el buscador | Seleccionar coincidencia exacta de código o producto resaltado |
| Flechas arriba / abajo | Mover selección de resultados |
| Enter en cantidad | Agregar al carrito |
| Espacio en el buscador vacío o fuera de campos | Abrir cobro |
| Enter en cobro | Confirmar la venta con los valores ingresados |
| Tab / Shift+Tab | Avanzar / retroceder entre campos |
| Esc | Cerrar la ventana actual |

La cantidad comienza en **1** para unidades y metros. En verduras se exige ingresar los **gramos**. El catálogo de verduras usa **libra de 500 gramos**: precio por gramo = precio por libra ÷ 500. Ejemplo: una libra a $2.000, 250 g = $1.000. El costo de cada recepción se ingresa según la base indicada por el formulario. También se admiten productos a precio por kilogramo; los productos anteriores conservan su base original y los costos históricos no se cambian al editar precios.

No se estima el peso: sin báscula conectada debes ingresar un peso obtenido externamente. Un lector futuro que emule teclado y termine en Enter utilizará el mismo buscador; todavía no se ha probado con tu equipo físico.

En nombres de productos, Espacio sigue permitiendo escribir normalmente. Los controles nativos requieren Tab y flechas además de Enter y Espacio. No se sacrifica la escritura de nombres por los atajos.

## Pagos, fiados y abonos

- Medios: efectivo, Nequi, Daviplata, Bancolombia y datáfono.
- Los cinco medios aparecen siempre visibles. Efectivo comienza con el total. Al escribir en un medio electrónico, se resta automáticamente del efectivo: venta de $1.000 y Nequi de $500 dejan $500 en efectivo. Borrar Nequi devuelve esa parte a efectivo. Los otros medios electrónicos mantienen sus valores.
- Puedes editar el efectivo manualmente para indicar dinero recibido y calcular cambio, o reducirlo y registrar el faltante como fiado. Editar después un medio electrónico vuelve a calcular el efectivo restante.
- El cambio únicamente se descuenta del efectivo recibido. Se impide una transferencia superior al total.
- El registro de un pago electrónico **no procesa ni confirma** una transacción bancaria. Verifica el soporte antes de registrar el cobro.
- Para fiar, crea el cliente y asígnale un cupo. Cupo cero significa que no puede recibir crédito.
- Selecciona cliente, marca dejar saldo fiado e indica la fecha acordada. El sistema verifica el saldo acumulado contra el cupo.
- Los abonos se registran en Clientes y fiados contra una venta pendiente, con caja abierta y medio de pago. Generan recibo.
- La cartera se calcula con todos los saldos activos; no depende del rango de fechas de ventas.

## Inventario y lotes

Cada recepción crea un lote con proveedor, referencia de compra, costo y fecha. Al vender se usa primero el lote con el vencimiento más cercano (FEFO); los lotes sin vencimiento salen después. Los vencidos antes de la fecha actual se bloquean para venta. El día de vencimiento permanece disponible durante ese día: cambia esta política si tu operación requiere retirarlos antes.

Las verduras se almacenan en gramos enteros; los productos por unidad, en unidades enteras; las longitudes, en milímetros internos, con entrada en metros hasta tres decimales. No se permite inventario negativo. Los movimientos de venta, recepción, merma y anulación quedan registrados. Las entradas no manejan conversión automática caja/unidad: convierte a la unidad base antes de recibir.

Para faltantes, vencidos o averías utiliza **Lotes y vencimientos → Registrar merma**. Para una entrada adicional registra una recepción identificada con su motivo. No borres ni cambies saldos directamente en la base de datos.

## Cotizaciones de ferretería

Arma el carrito, selecciona el cliente y pulsa Guardar cotización. Define su vigencia y condiciones. No reserva ni descuenta existencias. Desde Cotizaciones, Convertir a venta carga los productos a **precios vigentes**, indicando que debes revisarlos antes del cobro. La venta valida inventario y evita convertir dos veces la misma cotización.

## Caja y recibos

Hay una caja abierta por negocio. Puede haber ambas abiertas simultáneamente; comparten el portal, pero no el dinero ni los saldos. Si ambos negocios usan un mismo cajón físico, separa el efectivo físicamente para poder conciliarlo.

Efectivo esperado = base inicial + pagos en efectivo netos de cambio + abonos en efectivo + entradas − retiros − devoluciones de anulaciones. Nequi y demás medios no aumentan el efectivo esperado. El cierre exige explicación cuando hay diferencia y muestra el recaudo separado por medio.

Toda venta confirmada guarda los datos que permiten regenerar el recibo aunque falle o se cancele la impresión. La aplicación abre el diálogo de impresión del navegador: escoge la impresora POS, ancho de papel configurado, escala adecuada y sin encabezados/pies del navegador. No hay impresión silenciosa ni comandos ESC/POS directos, corte automático o apertura de cajón. Eso requiere probar e integrar tu modelo de impresora.

La impresora física no ha sido verificada en este proyecto. La función Guardar PDF la proporciona el navegador; no necesitas un servicio de internet.

## Correos

En Ventas y recibos o desde un recibo, pulsa Correo e ingresa destinatario. Se agrega a una cola persistente. **Enviar pendientes** intenta entregar hasta 20 mensajes pendientes o con error. Sin conexión permanecen disponibles para reintentar. El adjunto es un recibo HTML imprimible, no una factura electrónica ni un PDF generado en el servidor.

El administrador debe iniciar el servidor con estas variables de entorno, según el correo contratado:

```powershell
$env:POS_SMTP_HOST = 'servidor-smtp-del-proveedor'
$env:POS_SMTP_PORT = '587'
$env:POS_SMTP_FROM = 'ventas@tu-dominio.com'
$env:POS_SMTP_USER = 'usuario-smtp'
$env:POS_SMTP_PASSWORD = 'clave-de-aplicacion'
py -3 server.py
```

Se usa STARTTLS. No pegues claves en el código, en capturas ni en archivos que vayas a compartir. La entrega real no está probada porque no se ha configurado un correo. Ante un error de entrega incierta, verifica primero la bandeja de enviados antes de reintentar.

## Facturación electrónica

**Está desactivada y no emite documentos fiscales.** La sección de configuración explica su activación futura. `electronic.py` contiene el contrato de integración; no es una conexión funcional con un proveedor.

Antes de activarla se deben implementar y comprobar los datos tributarios, impuestos por producto, numeración autorizada, ambiente de pruebas, validación del proveedor/DIAN, estados, XML/PDF, CUFE, notas crédito y contingencias. Ver `PROYECTO.md`. No se deben transmitir recibos históricos automáticamente.

## Reportes

El administrador puede consultar ventas del período, número de operaciones, ticket promedio, margen bruto estimado por costo de lote, productos vendidos, pagos por medio, cartera, vencimientos, stock mínimo, kárdex, aperturas/cierres, movimientos de efectivo y auditoría. Las ventas anuladas se excluyen del ingreso y margen; los reversos sí aparecen en recaudo.

Los CSV usan separador punto y coma y UTF-8. En esta versión exportan las magnitudes internas: dinero en **centavos de peso**, longitudes en **milímetros**, peso en **gramos** y cantidades de unidad en **unidades**. Divide dinero entre 100 y longitudes entre 1.000 al analizar el archivo. Los reportes no sustituyen la contabilidad ni calculan utilidad neta o declaraciones tributarias.

## Usuarios y permisos

Administrador: catálogo, recepción, mermas, cupos, usuarios, configuración, reportes, anulaciones y respaldos. Cajero: venta, apertura/cierre de caja propia, movimientos de efectivo, clientes sin cupo, abonos, recibos y cotizaciones. Ambos tienen acceso únicamente a los negocios asignados por la API. El rol administrador es de confianza global: puede crear otros administradores y descargar el respaldo de ambos negocios.

Sesiones de doce horas, contraseñas con PBKDF2 y sal aleatoria, cookies HttpOnly/SameSite, consultas parametrizadas, verificaciones de permisos en servidor y registro de acciones. Cambiar contraseña cierra todas las sesiones del usuario. No se incluye recuperación automática de contraseña por correo ni edición/desactivación de usuarios en esta versión.

## Respaldo y restauración

La base está en `data/comercio.sqlite3`. Usa Descargar respaldo con el sistema abierto: la copia emplea la API de respaldo de SQLite y es consistente, incluso con WAL. El respaldo incluye clientes, contraseñas cifradas mediante hash, ventas y ambos negocios: consérvalo de forma privada.

Para restaurar, un responsable técnico debe:

1. Detener todos los procesos del servidor y conservar una copia de la carpeta `data` actual.
2. Verificar la integridad del respaldo con `PRAGMA integrity_check`.
3. Apartar la base actual y sus archivos `-wal` y `-shm`, si existen, sin eliminarlos hasta validar la recuperación.
4. Copiar el respaldo como `data/comercio.sqlite3`.
5. Iniciar el servidor y verificar saldos, ventas y caja.

No copies solo el archivo principal mientras el servidor está trabajando. No se ha configurado una copia automática externa ni sincronización con la nube.

## Alcance y pruebas pendientes

Se entrega para **prueba piloto en un computador**, escuchando solamente en 127.0.0.1. Funciona sin internet siempre que ese computador y el servidor estén encendidos. No depende del almacenamiento del navegador para las ventas.

No está preparado para exposición directa a internet. Varios equipos de una red requerirían una instalación administrada con HTTPS, servicio estable, acceso de red y pruebas de concurrencia y hardware. No se incluyen sincronización entre sedes desconectadas, terminales con bases independientes, contabilidad completa, compras a crédito, impuestos fiscales, descuentos, devoluciones parciales o posteriores al cierre, ni recuperación de usuarios. Las anulaciones completas solo se permiten dentro de la caja actual y sin abonos.

Antes de operar en vivo, verifica con productos de prueba: pesos, precios, costos, pagos mixtos, abonos, arqueo, impresión física, restauración de respaldo y corte de internet. La protección frente a cortes eléctricos también depende del disco, sistema operativo y una UPS.

## Para quien mantenga el software

```powershell
py -3 -m unittest discover -s tests -v
py -3 server.py --port 8765
```

Arquitectura: **React + JavaScript** en la interfaz, **Python** en el servidor y **SQLite** en los datos. Consulta `PROYECTO.md` para decisiones y evolución.

Para editar la interfaz instala Node.js 18 o superior y ejecuta:

```powershell
npm ci
npm run dev
```

Deja también el servidor Python funcionando. `npm run dev` recompila React cuando guardas archivos; recarga el navegador para ver los cambios. Para generar la versión final, ejecuta `npm run build`. La primera instalación de dependencias necesita internet; el uso diario no.

Archivos principales para editar:

- `src/App.jsx`: navegación y coordinación de la aplicación.
- `src/pages/PointOfSale.jsx`: buscador y carrito.
- `src/components/Checkout.jsx`: pantalla de pagos.
- `src/lib/payments.js`: reparto entre medios y cálculo del efectivo restante.
- `src/components/OperationForm.jsx`: formularios de productos, inventario y caja.
- `src/pages/AdminPages.jsx`: reportes, inventario, clientes y configuración.
- `public/style.css`: diseño y variables de color por negocio.
- `vegetables.json`: catálogo inicial; se incorpora al iniciar el servidor sin sobrescribir referencias existentes. Los precios reales se editan en Inventario.

No edites `public/app.js` directamente: es el archivo generado por el compilador. Las atribuciones y licencias de las fotos están en `FOTOS.md` y en la sección Verduras del portal.
