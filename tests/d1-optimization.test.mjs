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
