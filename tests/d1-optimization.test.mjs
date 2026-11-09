import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = name => fs.readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

test("la migración D1 es aditiva y conserva la información existente", () => {
  const sql = read("cloudflare/migrations/0011_d1_read_optimization.sql");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS catalog_changes/);
  assert.match(sql, /CREATE TRIGGER IF NOT EXISTS catalog_lots_update/);
  assert.match(sql, /idx_catalog_changes_business_id/);
  assert.match(sql, /idx_products_catalog_page/);
  assert.match(sql, /idx_payments_sale/);
  assert.doesNotMatch(sql, /\b(?:DROP|DELETE FROM products|DELETE FROM lots|DELETE FROM sales)\b/i);
});

test("la migración de trazabilidad reconstruye saldos sin borrar inventario", () => {
  const sql = read("cloudflare/migrations/0023_stock_traceability.sql");
  assert.match(sql, /ADD COLUMN balance_before/);
  assert.match(sql, /ADD COLUMN request_id/);
  assert.match(sql, /SUM\(later\.qty\)/);
  assert.match(sql, /idx_stock_moves_request/);
  assert.doesNotMatch(sql, /\b(?:DROP|DELETE FROM products|DELETE FROM lots|DELETE FROM stock_moves)\b/i);
});

test("la instrumentación registra rows_read y rows_written sin parámetros", () => {
  const source = read("cloudflare/store.mjs");
  assert.match(source, /meta\.rows_read/);
  assert.match(source, /meta\.rows_written/);
  assert.match(source, /type:'d1_query'/);
  assert.doesNotMatch(source, /JSON\.stringify\(args\)/);
});

test("el navegador guarda el catálogo en IndexedDB y pagina de 30 en 30", () => {
  const catalog = read("src/lib/catalog.js");
  assert.match(catalog, /indexedDB\.open/);
  assert.match(catalog, /limit=after\?100:30/);
  assert.match(catalog, /while\(full&&!saved\.complete\)/);
  assert.match(catalog, /since=\$\{saved\.cursor\}/);
  assert.match(catalog, /page\.deleted/);
  assert.match(catalog, /resetIfChanged/);
  assert.match(catalog, /page\.epoch/);
});

test("un reinicio completo invalida el catálogo guardado en cada navegador", () => {
  const migration = read("cloudflare/migrations/0015_catalog_epoch.sql");
  const reset = read("cloudflare/reset-test-data.sql");
  const endpoint = read("cloudflare/read.mjs");
  assert.match(migration, /CREATE TABLE IF NOT EXISTS catalog_epochs/);
  assert.match(reset, /UPDATE catalog_epochs/);
  assert.match(reset, /DELETE FROM catalog_changes/);
  assert.match(endpoint, /SELECT epoch FROM catalog_epochs/);
  assert.match(endpoint, /mode:'full',epoch/);
  assert.match(endpoint, /mode:'incremental',epoch/);
});

test("un cambio de versión reemplaza los productos guardados en IndexedDB", async () => {
  const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const indexedDbDescriptor = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const memory = new Map();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
      getItem: key => memory.get(key) ?? null,
      setItem: (key, value) => memory.set(key, String(value)),
  }});
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
  try {
    localStorage.setItem("pos-catalog-snapshot-v1", JSON.stringify({
      1: { epoch: 4, products: [{ id: 900, name: "Producto eliminado" }], after: 900, cursor: 70, complete: true },
    }));
    const calls = [];
    const request = async path => {
      calls.push(path);
      if (path.includes("since=")) return { epoch: 5, products: [], deleted: [], cursor: 70, has_more: false };
      return { epoch: 5, products: [{ id: 1, name: "Papa común" }], deleted: [], after: 1, cursor: 80, has_more: false };
    };
    const { syncCatalog } = await import("../src/lib/catalog.js");
    const result = await syncCatalog(1, request);
    assert.deepEqual(result.products.map(product => product.name), ["Papa común"]);
    assert.ok(calls.some(path => path.includes("since=70")));
    assert.ok(calls.some(path => path.includes("after=0")));
  } finally {
    if (storageDescriptor) Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else delete globalThis.localStorage;
    if (indexedDbDescriptor) Object.defineProperty(globalThis, "indexedDB", indexedDbDescriptor);
    else delete globalThis.indexedDB;
  }
});

test("el POS no solicita historial ni lotes completos en cada venta", () => {
  const app = read("src/App.jsx");
  assert.match(app, /api\(b, `\/api\/state\?catalog=0&details=\$\{details \? 1 : 0\}&customers=\$\{customers \? 1 : 0\}`\)/);
  assert.match(app, /syncProductCatalog\(b, \{ full: details \}\)/);
  assert.match(app, /history: !\["pos", "vegetables"\]/);
  assert.doesNotMatch(app, /Promise\.all\(\[\s*api\(b, "\/api\/state"\),\s*api\(b, `\/api\/history/);
});

test("no existe polling periódico contra las rutas D1", () => {
  const source = [read("src/App.jsx"), read("src/lib/api.js")].join("\n");
  assert.doesNotMatch(source, /setInterval\s*\(/);
});

test("filtrar movimientos usa una sola ruta indexada sin recargar el catálogo", () => {
  const app = read("src/App.jsx"), worker = read("cloudflare/worker.mjs"), cloud = read("cloudflare/read.mjs");
  assert.match(app, /\/api\/stock-moves\?\$\{params\}/);
  assert.match(worker, /path==='\/api\/stock-moves'/);
  assert.match(cloud, /export async function stockHistory/);
  assert.match(cloud, /m\.business_id=\? AND m\.created>=\? AND m\.created<\?/);
  assert.match(cloud, /m\.kind=\?/);
});

test("existencias por lote no vuelve a descargar los 1500 productos", () => {
  const pages = read("src/pages/AdminPages.jsx"), worker = read("cloudflare/worker.mjs"), cloud = read("cloudflare/read.mjs");
  assert.match(pages, /"\/api\/inventory-lots"/);
  assert.match(worker, /inventoryLots/);
  assert.match(cloud, /WHERE l\.business_id=\? AND l\.qty>0/);
});

test("el resumen de caja agrupa las lecturas y usa un índice por caja", () => {
  const store = read("cloudflare/store.mjs");
  const migration = read("cloudflare/migrations/0020_cash_summary_index.sql");
  assert.match(store, /cash_payment_net FROM payments WHERE cash_id=\?/);
  assert.match(store, /moves_net FROM cash_moves WHERE cash_id=\?/);
  assert.doesNotMatch(store, /const value=async\(sql\)/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_sales_cash_status ON sales\(cash_id,status\)/);
  assert.doesNotMatch(migration, /\b(?:DROP|DELETE|UPDATE|INSERT)\b/i);
});

test("ventas y recibos incluye operaciones con lácteos sin sumarlas al reporte normal", () => {
  const endpoint = read("cloudflare/read.mjs");
  const page = read("src/pages/AdminPages.jsx");
  assert.match(endpoint, /s\.total\+COALESCE\(s\.dairy_total,0\) receipt_total/);
  assert.match(endpoint, /s\.total>0 OR COALESCE\(s\.dairy_total,0\)>0/);
  assert.match(page, /receipt_total \?\? s\.total/);
});

test("las escrituras D1 concurrentes abortan y reintentan sin compartir identificadores", () => {
  const store = read("cloudflare/store.mjs");
  const migration = read("cloudflare/migrations/0021_transaction_revision_guard.sql");
  assert.match(store, /version=CASE WHEN version=\? THEN version\+1 ELSE -1 END/);
  assert.match(store, /CHECK constraint failed\.\*version/);
  assert.match(migration, /version INTEGER NOT NULL CHECK\(version>=0\)/);
  assert.match(migration, /MAX\(version,0\)/);
});
