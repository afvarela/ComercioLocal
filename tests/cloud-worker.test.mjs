import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import worker from "../cloudflare/worker.mjs";
import { passwordCheck } from "../cloudflare/store.mjs";
import { receiptPlainText } from "../cloudflare/read.mjs";
import { statusPlan } from "../cloudflare/logistics.mjs";
import { buildInvoicePdfDocument } from "../cloudflare/invoice.mjs";

test("el catálogo pagina productos y agrega lotes solo para la página solicitada", () => {
  const source = fs.readFileSync(new URL("../cloudflare/read.mjs", import.meta.url), "utf8");
  assert.match(source, /WITH page AS \(SELECT id,business_id,sku,barcode,name/);
  assert.match(source, /LIMIT \?\) SELECT \$\{productFields\}/);
  assert.match(source, /LEFT JOIN lots l ON l\.product_id=p\.id/);
  assert.doesNotMatch(source, /SELECT SUM\(qty\) FROM lots WHERE product_id=p\.id/);
});

test("el Worker identifica claramente el limite diario de D1", () => {
  const source = fs.readFileSync(new URL("../cloudflare/worker.mjs", import.meta.url), "utf8");
  assert.match(source, /free tier daily row read limit/);
  assert.match(source, /503/);
});

class SetupDatabase {
  constructor() {
    this.user = null;
  }
  prepare(sql) {
    const database = this;
    let values = [];
    return {
      bind(...args) {
        values = args;
        return this;
      },
      async first() {
        if (sql.includes("SELECT 1 present FROM users"))
          return database.user ? { present: 1 } : null;
        if (sql.includes("SELECT id FROM users WHERE username="))
          return database.user ? { id: 1 } : null;
        throw new Error(`SQL no simulado: ${sql}`);
      },
      async run() {
        if (sql.startsWith("INSERT INTO users")) {
          if (database.user) return { meta: { changes: 0 } };
          database.user = {
            id: 1,
            username: values[0],
            name: values[1],
            password: values[2],
          };
          return { meta: { changes: 1 } };
        }
        if (sql.startsWith("INSERT OR REPLACE INTO finance_permissions") ||
            sql.startsWith("INSERT OR REPLACE INTO dairy_permissions"))
          return { meta: { changes: 1 } };
        throw new Error(`SQL no simulado: ${sql}`);
      },
    };
  }
  async batch(statements) {
    for (const statement of statements) await statement.run();
    return statements.map(() => ({ success: true }));
  }
}

function environment(database = new SetupDatabase()) {
  return {
    database,
    env: {
      DB: database,
      ASSETS: { fetch: async () => new Response("APP", { status: 200 }) },
    },
  };
}

function setupRequest(pin) {
  return new Request("https://comercio.example/api/setup", {
    method: "POST",
    headers: {
      Origin: "https://comercio.example",
      "Content-Type": "application/json",
      "X-POS-Request": "1",
    },
    body: JSON.stringify({ name: "Administrador", username: "admin", password: pin }),
  });
}

test("la pagina publica carga sin una sesion", async () => {
  const { env } = environment();
  const response = await worker.fetch(new Request("https://comercio.example/"), env);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "APP");
});

test("status solicita configuracion cuando D1 no tiene usuarios", async () => {
  const { env } = environment();
  const response = await worker.fetch(new Request("https://comercio.example/api/status"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { setup: true, cloud: true, version: "3.3.6" });
});

test("el primer administrador se crea solamente con un PIN de cuatro numeros", async () => {
  for (const invalid of ["123", "12345", "12a4", "abcd", ""]) {
    const { env } = environment();
    const response = await worker.fetch(setupRequest(invalid), env);
    assert.equal(response.status, 400, `el PIN ${JSON.stringify(invalid)} debia rechazarse`);
  }

  const { env, database } = environment();
  const response = await worker.fetch(setupRequest("1234"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(database.user.username, "admin");
  assert.equal(await passwordCheck("1234", database.user.password), true);
  assert.equal(await passwordCheck("4321", database.user.password), false);

  const status = await worker.fetch(new Request("https://comercio.example/api/status"), env);
  assert.equal((await status.json()).setup, false);
});

test("el archivo React publicado contiene PIN y validacion numerica", () => {
  const bundle = fs.readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
  assert.match(bundle, /PIN de acceso/);
  assert.match(bundle, /\[0-9\]\{4\}/);
  assert.doesNotMatch(bundle, /m.nimo 10 caracteres/i);
  assert.doesNotMatch(bundle, /\bproduction\s*===/, "NODE_ENV debe compilarse como texto, no como variable");
});

test("la configuracion inicial se muestra antes de consultar rutas privadas", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const setupDecision = app.indexOf("if (status.setup)");
  const protectedRefresh = app.indexOf("await refresh()", setupDecision);
  assert.ok(setupDecision >= 0, "falta la decision de configuracion inicial");
  assert.ok(protectedRefresh > setupDecision, "se consultan rutas privadas antes de mostrar el registro");
});

test("el Service Worker clona la respuesta antes de guardarla en cache", () => {
  const serviceWorker = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(serviceWorker, /const copy = response\.clone\(\)/);
  assert.match(serviceWorker, /cache\.put\([^,]+, copy\)/);
  assert.doesNotMatch(serviceWorker, /cache\.put\([^;]+response\.clone\(\)/);
});

test("Cloudflare filtra ventas y movimientos con la fecha de Colombia", () => {
  const read = fs.readFileSync(new URL("../cloudflare/read.mjs", import.meta.url), "utf8");
  const dairy = fs.readFileSync(new URL("../cloudflare/dairy.mjs", import.meta.url), "utf8");

  assert.match(read, /s\.created>=\? AND s\.created<\?/);
  assert.match(read, /SELECT date\(created,'-5 hours'\) day/);
  assert.match(read, /c\.opened>=\? AND c\.opened<\?/);
  assert.doesNotMatch(read, /substr\([^)]*(?:created|opened),1,10\)/);
  assert.match(read, /colombiaRange\(start,end\)/);
  assert.match(dairy, /date\(l\.created,'-5 hours'\) BETWEEN \? AND \?/);
});

test("las imagenes se buscan en la carpeta products de R2", async () => {
  let requestedKey = "";
  const { env } = environment();
  env.IMAGES = {
    async get(key) {
      requestedKey = key;
      return {
        body: "svg-data",
        httpEtag: "test-etag",
        writeHttpMetadata() {},
      };
    },
  };
  const response = await worker.fetch(new Request("https://comercio.example/images/aguacate.svg"), env);
  assert.equal(response.status, 200);
  assert.equal(requestedKey, "products/aguacate.svg");
  assert.match(response.headers.get("Content-Type"), /^image\/svg\+xml/);
});

test("el punto de venta usa una cuadricula compacta de cuatro columnas", () => {
  const css = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  assert.match(css, /\.products\{grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css, /\.product-card,.product-card\.has-image\{min-height:132px/);
});

test("la aplicacion incluye manifiesto PWA y arranque offline", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../public/manifest.webmanifest", import.meta.url), "utf8").replace(/^\uFEFF/, ""));
  const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const serviceWorker = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/?source=pwa");
  assert.match(html, /rel="manifest"/);
  for (const asset of ["/index.html", "/app.js", "/style.css", "/manifest.webmanifest"])
    assert.ok(serviceWorker.includes(`"${asset}"`), `${asset} debe estar en la cache PWA`);
  assert.match(serviceWorker, /request\.mode === "navigate"/);
});

test("el cobro usa teclado físico y F5 abre fiadores", () => {
  const checkout = fs.readFileSync(new URL("../src/components/Checkout.jsx", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const pages = fs.readFileSync(new URL("../src/pages/AdminPages.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(checkout, /keypadOpen|numeric-pad|keypadValue/);
  assert.match(checkout, /autoFocus=\{index === 0\}/);
  assert.match(checkout, /requestSubmit\(printButton\.current\)/);
  assert.match(checkout, /nombre o c.dula/);
  assert.match(app, /e\.key==="F5"/);
  assert.match(pages, /Clientes fiadores/);
  assert.match(pages, /total_purchases/);
});

test("el punto de venta abre un buscador de cliente para fiados", () => {
  const pointOfSale = fs.readFileSync(new URL("../src/pages/PointOfSale.jsx", import.meta.url), "utf8");
  assert.match(pointOfSale, /setCustomerPicker\(true\)/);
  assert.match(pointOfSale, /Seleccionar cliente para fiado/);
  assert.match(pointOfSale, /Buscar por nombre o c.dula/);
  assert.match(pointOfSale, /customer\.document/);
});

test("ferretería usa buscador, filas de productos y total lateral", () => {
  const pointOfSale = fs.readFileSync(new URL("../src/pages/PointOfSale.jsx", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  assert.match(pointOfSale, /business === 2 && !vegetables/);
  assert.match(pointOfSale, /hardware-products-table/);
  assert.match(pointOfSale, /hardware-cart-table/);
  assert.match(pointOfSale, /Productos agregados/);
  assert.match(pointOfSale, /hardware-grand-total/);
  assert.match(styles, /\.hardware-pos-layout\{display:grid/);
  assert.match(styles, /\.hardware-table\{width:100%;border-collapse:collapse/);
  assert.match(styles, /\.hardware-sale-total\{position:sticky/);
});

test("mini market permite alternar y recordar tarjetas o filas", () => {
  const pointOfSale = fs.readFileSync(new URL("../src/pages/PointOfSale.jsx", import.meta.url), "utf8");
  const styles = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  assert.match(pointOfSale, /comercio-pos-market-view/);
  assert.match(pointOfSale, /changeMarketView\("cards"\)/);
  assert.match(pointOfSale, /changeMarketView\("rows"\)/);
  assert.match(pointOfSale, /marketView === "rows"/);
  assert.match(pointOfSale, /market-products-table/);
  assert.match(pointOfSale, /market-row-photo/);
  assert.match(styles, /\.market-view-switch/);
  assert.match(styles, /\.market-products-table/);
});

test("la interfaz aumenta de forma fluida en monitores grandes", () => {
  const css = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  assert.match(css, /@media screen and \(min-width:1500px\) and \(min-height:780px\)/);
  assert.match(css, /font-size:clamp\(16px,.92vw,19px\)/);
  assert.match(css, /grid-template-columns:repeat\(auto-fit,minmax\(clamp\(175px,11vw,230px\),1fr\)\)/);
  assert.match(css, /\.workspace\{width:100%;max-width:none/);
});

test("ferretería ofrece factura carta, PDF y envío por WhatsApp Web", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const sales = fs.readFileSync(new URL("../src/pages/AdminPages.jsx", import.meta.url), "utf8");
  const dialog = fs.readFileSync(new URL("../src/components/LetterInvoice.jsx", import.meta.url), "utf8");
  const apiSource = fs.readFileSync(new URL("../src/lib/api.js", import.meta.url), "utf8");
  const workerSource = fs.readFileSync(new URL("../cloudflare/worker.mjs", import.meta.url), "utf8");
  assert.match(sales, /business === 2/);
  assert.match(sales, /Factura carta/);
  assert.match(sales, /invoice_download/);
  assert.match(apiSource, /export async function downloadInvoicePdf/);
  assert.match(apiSource, /contentType\.includes\("application\/pdf"\)/);
  assert.match(apiSource, /\.pdf`/);
  assert.match(app, /case "invoice_whatsapp"/);
  assert.match(app, /web\.whatsapp\.com|wa\.me/);
  assert.match(dialog, /Factura tamaño carta/);
  assert.match(workerSource, /path==='\/invoice'/);
  assert.match(workerSource, /path==='\/invoice\.pdf'/);
});

test("la factura PDF de Cloudflare usa papel carta y contiene el detalle", () => {
  const pdf = buildInvoicePdfDocument(
    { name: "Ferreteria Prueba", nit: "900123", address: "Calle 1", phone: "3001234567" },
    {
      id: 4,
      code: "FE-000004",
      number: 4,
      created: "2026-10-12T10:00:00-05:00",
      operator: "Admin",
      cash_id: 1,
      status: "active",
      total: 1200000,
      debt: 0,
      customer: { name: "Cliente Uno", document: "123" },
      payments: [{ method: "Nequi", amount: 1200000 }],
      lines: [{ name: "Taladro profesional", description: "500 W", sku: "TAL-1", unit: "und", qty: 1, price: 1200000, total: 1200000 }],
    },
  );
  const source = Buffer.from(pdf).toString("latin1");
  assert.match(source, /^%PDF-1\.4/);
  assert.match(source, /\/MediaBox \[0 0 612 792\]/);
  assert.match(source, /Taladro profesional/);
  assert.match(source, /Nequi/);
});

test("el Service Worker nunca reutiliza comprobantes de otro despacho", () => {
  const worker = fs.readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
  assert.match(worker, /"\/dispatch"/);
  assert.match(worker, /"\/dispatch\.txt"/);
  assert.match(worker, /"\/labels-preview"/);
  assert.match(worker, /const CACHE = "comercio-local-[A-Za-z0-9-]+"/);
  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
});

test("al confirmar una venta permite elegir imprimir o no imprimir", () => {
  const checkout = fs.readFileSync(new URL("../src/components/Checkout.jsx", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const ui = fs.readFileSync(new URL("../src/components/UI.jsx", import.meta.url), "utf8");
  assert.match(checkout, /Confirmar sin imprimir/);
  assert.match(checkout, /Confirmar e imprimir/);
  assert.match(checkout, /_print_receipt/);
  assert.match(app, /if \(!shouldPrint\)/);
  assert.match(ui, /nativeEvent\?\.submitter/);
});

test("el POS soporta lectura rápida, F8, cobro compacto y libera la venta antes de imprimir", () => {
  const checkout = fs.readFileSync(new URL("../src/components/Checkout.jsx", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const pos = fs.readFileSync(new URL("../src/pages/PointOfSale.jsx", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  assert.match(pos, /\{ scanned, product \}/);
  assert.match(pos, /event\.key === "F8"/);
  assert.match(pos, /scrollIntoView/);
  assert.match(app, /if \(index == null && !productNeedsWeight\(p\)\)/);
  assert.match(app, /automaticProductQuantity\(p\)/);
  assert.match(app, /close\(\);\s*refresh\(\)\.catch/);
  assert.match(app, /printing\.then/);
  assert.match(checkout, /cash_received: payment\.cash/);
  assert.match(checkout, /change_given: payment\.change/);
  assert.match(css, /\.checkout-dialog \.payment-list\{grid-template-columns:repeat\(2/);
});

test("al pulsar Punto de venta sincroniza solo estado y catálogo incremental", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(app, /async function navigate\(id\)/);
  assert.match(app, /syncProductCatalog\(b, \{ full: details \}\)/);
  assert.match(app, /catalog=0&details=/);
  assert.match(app, /history: !\["pos", "vegetables"\]\.includes\(id\)/);
  assert.match(app, /onClick=\{\(\) => navigate\(id\)\}/);
});

test("los lacteos usan el carrito existente y tienen control separado", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const pos = fs.readFileSync(new URL("../src/pages/PointOfSale.jsx", import.meta.url), "utf8");
  const checkout = fs.readFileSync(new URL("../src/components/Checkout.jsx", import.meta.url), "utf8");
  const dairy = fs.readFileSync(new URL("../src/pages/Dairy.jsx", import.meta.url), "utf8");
  assert.match(app, /Control de lácteos/);
  assert.match(pos, /LÁCTEOS CASEROS/);
  assert.match(checkout, /dairy_lines/);
  assert.match(dairy, /Cuadrar el día/);
  assert.match(dairy, /Exportar Excel/);
});

test("ventas muestran medio de pago y la impresora usa el agente compatible", () => {
  const sales = fs.readFileSync(new URL("../src/pages/AdminPages.jsx", import.meta.url), "utf8");
  const dairy = fs.readFileSync(new URL("../src/pages/Dairy.jsx", import.meta.url), "utf8");
  const printer = fs.readFileSync(new URL("../src/lib/printer.js", import.meta.url), "utf8");
  const agent = fs.readFileSync(new URL("../printer-agent.py", import.meta.url), "utf8");
  assert.match(sales, /Medio de pago/);
  assert.match(dairy, /payment_methods/);
  assert.match(printer, /127\.0\.0\.1:8768/);
  assert.match(agent, /print_driver/);
  assert.match(agent, /Access-Control-Allow-Private-Network/);
});

test("despachos permiten seleccionar una impresora predeterminada", () => {
  const printer = fs.readFileSync(new URL("../src/lib/printer.js", import.meta.url), "utf8");
  const agent = fs.readFileSync(new URL("../printer-agent.py", import.meta.url), "utf8");
  const settings = fs.readFileSync(new URL("../src/pages/AdminPages.jsx", import.meta.url), "utf8");
  assert.match(printer, /comercio-dispatch-printer/);
  assert.match(printer, /selectedDispatchPrinter\(\)/);
  assert.match(printer, /font_size: 7, margin_mm: 0\.5, right_margin_mm: 5/);
  assert.match(agent, /def print_driver\(name,text,font_size=9,margin_mm=1\.5,right_margin_mm=0\)/);
  assert.match(settings, /Impresora de despachos/);
  assert.match(settings, /Probar impresora de despachos/);
});

test("crear un despacho imprime directamente sin abrir otra ventana", () => {
  const logistics = fs.readFileSync(new URL("../src/pages/Logistics.jsx", import.meta.url), "utf8");
  assert.match(logistics, /await\s+printDispatch\(business,\s*result\.id\)/);
  assert.doesNotMatch(logistics, /window\.open\(`\/dispatch\?business=\$\{business\}&id=\$\{result\.id\}/);
});

test("crear despacho usa la fecha de Colombia y muestra los errores de la API", () => {
  const logistics = fs.readFileSync(new URL("../src/pages/Logistics.jsx", import.meta.url), "utf8");
  const format = fs.readFileSync(new URL("../src/lib/format.js", import.meta.url), "utf8");
  assert.match(logistics, /colombiaDate\(x\.created\)\s*===\s*saleDate/);
  assert.match(logistics, /defaultValue=\{localDate\(\)\}/);
  assert.match(logistics, /No se pudo crear el despacho:/);
  assert.match(logistics, /No hay ventas con mercancía pendiente/);
  assert.match(format, /timeZone: "America\/Bogota"/);
});

test("los despachos activos se pueden marcar como entregados", () => {
  const logistics = fs.readFileSync(new URL("../src/pages/Logistics.jsx", import.meta.url), "utf8");
  const backend = fs.readFileSync(new URL("../logistics.py", import.meta.url), "utf8");
  assert.match(logistics, /quickStatuses[\s\S]{0,80}\.filter\(\(status\)\s*=>\s*status\s*!==\s*x\.status\)/);
  assert.match(logistics, /onClick=\{\(\)\s*=>\s*changeStatus\(x,\s*status\)\}/);
  assert.match(logistics, /setData\(\(current\)\s*=>/);
  assert.match(logistics, /No se pudo actualizar el pedido/);
  assert.match(logistics, /type="button"/);
  assert.match(logistics, /Reabrir como pendiente/);
  assert.match(logistics, /changeStatus\(x,\s*"Pendiente"\)/);
  assert.match(logistics, /const partial\s*=\s*status\s*===\s*"Entrega parcial"/);
  assert.match(logistics, /quickStatuses\s*=\s*\["En reparto",\s*"Entregado",\s*"Cancelado"\]/);
  assert.doesNotMatch(logistics, /status==="Cancelado"&&!confirm/);
  assert.match(backend, /'Pendiente':\{'En preparacion','Entregado','Cancelado'\}/);
  assert.match(backend, /'Entregado':\{'Pendiente'\}/);
  assert.match(backend, /target in QUICK_STATUSES/);
  assert.match(backend, /SET delivered_qty=0/);
  assert.match(backend, /if target=='Entregado'/);
});

test("Cloudflare implementa y persiste los estados de despachos", () => {
  const worker = fs.readFileSync(new URL("../cloudflare/worker.mjs", import.meta.url), "utf8");
  const migration = fs.readFileSync(new URL("../cloudflare/migrations/0010_logistics.sql", import.meta.url), "utf8");
  assert.match(worker, /path==='\/api\/logistics-command'/);
  assert.match(worker, /logisticsCommand\(env\.DB,u,b,d\.action/);
  assert.match(worker, /path==='\/api\/logistics'/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS dispatches/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS dispatch_history/);
  assert.deepEqual(statusPlan("Pendiente", "En reparto"), { reset: true, complete: false, delivered: false });
  assert.deepEqual(statusPlan("En reparto", "Entregado"), { reset: false, complete: true, delivered: true });
  assert.deepEqual(statusPlan("Entregado", "Pendiente"), { reset: true, complete: false, delivered: false });
  assert.throws(() => statusPlan("Pendiente", "Pendiente"), /Transición/);
});

test("el diseñador de etiquetas previsualiza y envia sus medidas", () => {
  const logistics = fs.readFileSync(new URL("../src/pages/Logistics.jsx", import.meta.url), "utf8");
  const printer = fs.readFileSync(new URL("../src/lib/printer.js", import.meta.url), "utf8");
  const agent = fs.readFileSync(new URL("../printer-agent.py", import.meta.url), "utf8");
  assert.match(logistics, /className="designer-label"/);
  assert.match(logistics, /field="name_size"/);
  assert.match(logistics, /field="price_size"/);
  assert.match(logistics, /field="barcode_height"/);
  assert.match(logistics, /field="barcode_gap_mm"/);
  assert.match(logistics, /field="gap_mm"/);
  assert.match(logistics, /field="row_gap_mm"/);
  assert.match(logistics, /field="page_margin_mm"/);
  assert.match(logistics, /Dos por fila compactas/);
  assert.match(logistics, /const payload\s*=\s*\{[\s\S]{0,80}\.\.\.design,[\s\S]{0,80}items:/);
  assert.match(logistics, /Vista previa exacta/);
  assert.match(logistics, /await\s+printLabels\(business,\s*html\)/);
  assert.doesNotMatch(logistics, /addEventListener\("load",\(\)=>w\.print\(\)/);
  assert.match(printer, /\/print-labels/);
  assert.doesNotMatch(printer, /foreignObject|drawImage\(/);
  assert.match(printer, /drawBarcode/);
  assert.match(printer, /dataset\.columns/);
  assert.match(printer, /index\+=columns/);
  assert.match(agent, /y_offset\+=target_h/);
  assert.match(agent, /def print_label_bitmaps/);
});

test("Cloudflare genera codigos de barras SVG reales para las etiquetas", () => {
  const cloud = fs.readFileSync(new URL("../cloudflare/logistics.mjs", import.meta.url), "utf8");
  const designer = fs.readFileSync(new URL("../src/pages/Logistics.jsx", import.meta.url), "utf8");
  const printer = fs.readFileSync(new URL("../src/lib/printer.js", import.meta.url), "utf8");
  assert.match(cloud, /CODE128_PATTERNS/);
  assert.match(cloud, /function barcodeSvg/);
  assert.match(cloud, /barcodeSvg\(product\.barcode\|\|product\.sku/);
  assert.match(cloud, /row_gap_mm/);
  assert.match(cloud, /page_margin_mm/);
  assert.match(cloud, /barcode_gap_mm/);
  assert.match(cloud, /maximumFractionDigits:0/);
  assert.match(cloud, /labelMoney\(product\.price\)/);
  assert.doesNotMatch(cloud, /<div class="sku">/);
  assert.doesNotMatch(cloud, /<div class="barcode-value">Código:/);
  assert.doesNotMatch(designer, /className="designer-sku"/);
  assert.match(designer, /labelPrice\(sample\.price\)/);
  assert.match(designer, /Papel 58 mm/);
  assert.match(printer, /classList\.contains\("price"\)/);
});

test("inventario cierra la merma antes de refrescar y permite editar el costo", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const form = fs.readFileSync(new URL("../src/components/OperationForm.jsx", import.meta.url), "utf8");
  assert.match(app, /type === "waste" \|\| type === "product"/);
  assert.match(app, /close\(\);[\s\S]{0,100}await refresh/);
  assert.match(form, /name="current_cost"/);
  assert.match(form, /Las compras y ventas anteriores conservarán su costo histórico/);
});

test("logistica conserva tildes y eñes sin mojibake", () => {
  const logistics = fs.readFileSync(new URL("../src/pages/Logistics.jsx", import.meta.url), "utf8");
  const backend = fs.readFileSync(new URL("../logistics.py", import.meta.url), "utf8");
  assert.doesNotMatch(logistics + backend, /Ã|Â|�/);
  assert.match(logistics, /Diseñador de etiquetas/);
  assert.match(logistics, /Tamaño del precio/);
  assert.match(logistics, /código de barras/);
  assert.match(backend, /Tel\\u00e9fono/);
  assert.match(backend, /SATISFACCI\\u00d3N/);
});

test("ventas conservan su columna POS segura y despachos mantienen su formato", () => {
  const server = fs.readFileSync(new URL("../server.py", import.meta.url), "utf8");
  const logistics = fs.readFileSync(new URL("../logistics.py", import.meta.url), "utf8");
  assert.match(server, /pos_product_receipt_lines\(d\['lines'\],width\)/);
  assert.match(logistics, /product_receipt_lines\(d\['lines'\],width(?:,[^)]+)?\)/);
});

test("Cloudflare expone el recibo de texto que necesita la impresora POS", () => {
  const workerSource = fs.readFileSync(new URL("../cloudflare/worker.mjs", import.meta.url), "utf8");
  assert.match(workerSource, /path==='\/receipt\.txt'/);
  assert.match(workerSource, /receiptText/);
  const text = receiptPlainText('<style>body{width:72mm}</style><button>Imprimir</button><header><h1>TIENDA EL DESCANSO MONTAÑITAS</h1><p>900123456<br>Vereda Montañitas vía principal local número 25<br>3134234</p><h2>Recibo de venta</h2><b>MM-000001</b></header><p>2026-10-02T13:15:30Z<br>Atendió: Ana</p><p><b>Producto con una descripción demasiado larga para una sola línea</b><br>2 unidad × $ 4.000<strong>$ 8.000</strong></p><h2>Total $ 8.000</h2><p>Venta Nequi<strong>$ 8.000</strong></p><footer>Gracias</footer>');
  assert.match(text, /\[\[CENTER_BOLD_LARGE\]\]TIENDA EL DESCANSO\n\[\[CENTER_BOLD_LARGE\]\]MONTAÑITAS/);
  assert.match(text, /NIT: 900123456/);
  assert.match(text, /TEL: 3134234/);
  assert.match(text, /DIRECCION: Vereda Montañitas/);
  assert.match(text, /PRODUCTO\s+VALOR/);
  assert.match(text, /Producto con una\s+\$ 8\.000/);
  assert.match(text, /descripción demasiado/);
  assert.match(text, /02-10-2026 08:15:30/);
  assert.match(text, /Comprobante interno/);
  assert.match(text, /Gracias por su compra/);
  assert.doesNotMatch(text, /<[^>]+>|Imprimir|<style>/);
  for (const line of text.split("\n")) {
    const printable = line.replace(/^\[\[[A-Z_]+\]\]/, "");
    assert.ok(printable.length <= 38, `la línea excede el ancho POS: ${printable}`);
  }
});




