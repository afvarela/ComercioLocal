import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { validateInventoryQuantity } from "../src/lib/cartInventory.js";
import { accountStatementHtml } from "../src/lib/printer.js";

const product = { id: 7, name: "Arroz", unit: "und", available: 3 };

test("permite agregar y editar cantidades dentro de la existencia", () => {
  assert.equal(validateInventoryQuantity(product, [], 1).ok, true);
  assert.equal(validateInventoryQuantity(product, [{ id: 7, qty: 2 }], 3, 0).ok, true);
});

test("rechaza inventario cero, negativo y cantidades superiores", () => {
  assert.equal(validateInventoryQuantity({ ...product, available: 0 }, [], 1).reason, "empty");
  assert.equal(validateInventoryQuantity({ ...product, available: -2 }, [], 1).reason, "empty");
  assert.equal(validateInventoryQuantity(product, [], 4).reason, "insufficient");
  assert.equal(validateInventoryQuantity(product, [{ id: 7, qty: 2 }], 2).reason, "insufficient");
  assert.equal(validateInventoryQuantity(product, [{ id: 7, qty: 2 }], 4, 0).reason, "insufficient");
});

test("los formularios del POS no dependen del historial completo", () => {
  const source = fs.readFileSync(new URL("../src/components/OperationForm.jsx", import.meta.url), "utf8");
  assert.match(source, /history = \{\}/);
  assert.match(source, /const safeHistory = history \|\| \{\}/);
  assert.doesNotMatch(source, /history\.debts\.find/);
});

test("clientes ofrece estado de cuenta y reporte diario de fiados", () => {
  const page = fs.readFileSync(new URL("../src/pages/AdminPages.jsx", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const preview = fs.readFileSync(new URL("../src/components/AccountStatement.jsx", import.meta.url), "utf8");
  assert.match(page, /Fiados del día/);
  assert.match(page, /Imprimir estado de cuenta/);
  assert.match(app, /\/api\/customer-statement\?id=/);
  assert.match(app, /type: "account_statement"/);
  assert.match(preview, /Imprimir \/ guardar PDF/);
  assert.match(preview, /srcDoc=\{html\}/);
});

test("estado de cuenta muestra facturas y productos sin repetir fiado ni saldo por compra", () => {
  const html = accountStatementHtml("Tienda El Descanso", {
    customer: { name: "Cliente prueba", document: "123" },
    sales: [{
      number: 15,
      created: "2026-11-04T14:30:00.000Z",
      lines: [{ name: "Aguacate", qty: 222, unit: "g", price: 800000, price_basis: 500, total: 355200 }],
      original_debt: 355200,
      debt: 155200,
    }],
    total_credit: 355200,
    payments: 200000,
    returns: 0,
    balance: 155200,
  });
  assert.match(html, /Factura #000015/);
  assert.match(html, /Fecha:/);
  assert.match(html, /Aguacate/);
  assert.match(html, /222 g/);
  assert.match(html, /\$\s3\.552/);
  assert.match(html, /Saldo pendiente/);
  assert.doesNotMatch(html, /Fiado de la compra/);
  assert.doesNotMatch(html, /Saldo de la compra/);
});

test("contabilidad registra facturas y utilidades sin saldos del POS", () => {
  const local = fs.readFileSync(new URL("../finance.py", import.meta.url), "utf8");
  const cloud = fs.readFileSync(new URL("../cloudflare/finance.mjs", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../src/pages/Accounting.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(local, /new<0/);
  assert.doesNotMatch(cloud, /balance>=0/);
  assert.doesNotMatch(local, /sum\(allocations\.values\(\)\)!=profit/);
  assert.doesNotMatch(cloud, /allocations\.reduce\(\(n,x\)=>n\+x\.amount,0\)===profit/);
  assert.doesNotMatch(local, /\bFROM sales\b/i);
  assert.doesNotMatch(cloud, /\bFROM sales\b/i);
  assert.match(page, /independientes de las ventas/);
  assert.match(page, /no validan el saldo disponible/);
  assert.match(page, /no tienen que coincidir entre sí/);
});

test("cierre separa base efectivo Nequi fiados y salida real", () => {
  const form = fs.readFileSync(new URL("../src/components/OperationForm.jsx", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../src/pages/AdminPages.jsx", import.meta.url), "utf8");
  const style = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  assert.match(form, /Total a contar en caja/);
  assert.match(form, /pago en efectivo al proveedor de quesos/);
  assert.match(page, /Efectivo del turno \(sin base\)/);
  assert.match(page, /Total ventas \(efectivo \+ Nequi\)/);
  assert.match(page, /c\.collected_sales_total/);
  assert.match(page, /Ajuste de efectivo y Nequi/);
  assert.match(style, /movement-filter-bar/);
});

test("la recepción vuelve a mostrar el costo guardado y refresca el inventario", () => {
  const form = fs.readFileSync(new URL("../src/components/OperationForm.jsx", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(form, /key=\{`cost-\$\{selectedProduct\}`\}/);
  assert.match(form, /defaultValue=\{\(receiving\?\.current_cost \|\| 0\) \/ 100\}/);
  assert.match(app, /\["waste", "product", "receive"\]\.includes\(type\)/);
  assert.match(app, /Mercancía recibida y costo actualizado/);
});

test("cantidad y producto no registrado renderizan con history nulo", async () => {
  const entry = `
    import React from "react";
    import { renderToStaticMarkup } from "react-dom/server";
    import OperationForm from "./src/components/OperationForm.jsx";
    const product={id:1,name:"Arroz",sku:"ARR-1",description:"Arroz",category:"Granos",unit:"und",price:500000,price_basis:1,available:5};
    const state={products:[product],customers:[],lots:[],businesses:[{id:1,name:"Mini market"}]};
    export function render(type){
      const config=type==="quantity"?{type,id:1,product,initial:1}:{type};
      return renderToStaticMarkup(React.createElement(OperationForm,{config,state,history:null,business:1,admin:true,onClose(){},onSubmit(){}}));
    }
  `;
  const output = await build({ stdin: { contents: entry, resolveDir: fileURLToPath(new URL("../", import.meta.url)), sourcefile: "pos-form-test.jsx", loader: "jsx" }, bundle: true, write: false, packages: "external", platform: "node", format: "esm", jsx: "automatic", logLevel: "silent" });
  const temporaryModule = new URL("./.pos-form-render-test.mjs", import.meta.url);
  fs.writeFileSync(temporaryModule, output.outputFiles[0].contents);
  try {
    const module = await import(`${temporaryModule.href}?run=${Date.now()}`);
    assert.match(module.render("quantity"), /Arroz/);
    const unregistered = module.render("unregistered_product");
    assert.match(unregistered, /Producto no registrado/);
    assert.match(unregistered, /OTROS/);
    assert.match(unregistered, /DULCES DETAL/);
    assert.match(unregistered, /PAPELERIA/);
  } finally {
    fs.rmSync(temporaryModule, { force: true });
  }
});

test("el cobro usa teclado físico, foco en efectivo y Enter", () => {
  const source = fs.readFileSync(new URL("../src/components/Checkout.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /keypadOpen|numeric-pad|pressKey|keypadValue/);
  assert.match(source, /autoFocus=\{index === 0\}/);
  assert.match(source, /requestSubmit\(printButton\.current\)/);
});

test("el cobro bloquea todos los botones mientras procesa la venta", () => {
  const modal = fs.readFileSync(new URL("../src/components/UI.jsx", import.meta.url), "utf8");
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  assert.match(modal, /Procesando venta…/);
  assert.match(modal, /lockActions/);
  assert.match(app, /saleCommit\.current/);
  assert.match(app, /requestId: uid\(\)/);
  assert.match(app, /payload\.request_id = modal\.requestId/);
});

test("productos no registrados usan opciones configurables y notas", () => {
  const form = fs.readFileSync(new URL("../src/components/OperationForm.jsx", import.meta.url), "utf8");
  const migration = fs.readFileSync(new URL("../cloudflare/migrations/0014_unregistered_options.sql", import.meta.url), "utf8");
  assert.match(form, /state\.unregistered_options/);
  assert.match(form, /name="note"/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS unregistered_options/);
});

test("el recibo offline conserva centavos COP sin agregar tres ceros", () => {
  const printer = fs.readFileSync(new URL("../src/lib/printer.js", import.meta.url), "utf8");
  assert.match(printer, /cop\(lineTotal\(item\)\)/);
  assert.match(printer, /Math\.round\(Number\(p\.amount\) \* 100\)/);
  assert.doesNotMatch(printer, /item\.price \* item\.qty/);
});

test("ventas y reportes combinan filtros sin nuevas consultas por cada tecla", () => {
  const pages = fs.readFileSync(new URL("../src/pages/AdminPages.jsx", import.meta.url), "utf8");
  assert.match(pages, /customerFilter/);
  assert.match(pages, /productFilter/);
  assert.match(pages, /categoryFilter/);
  assert.match(pages, /paymentFilter/);
  assert.match(pages, /filteredSales/);
});

test("el POS muestra el error de inventario arriba y sin bloquear", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const css = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  assert.match(app, /inventario insuficiente/);
  assert.match(app, /toast\(text, "error", 4000\)/);
  assert.match(css, /\.react-toast\.error\{top:18px;bottom:auto;background:#b42318/);
});

test("la búsqueda remota tiene debounce y usa el índice FTS", () => {
  const hook = fs.readFileSync(new URL("../src/lib/useProductSearch.js", import.meta.url), "utf8");
  const read = fs.readFileSync(new URL("../cloudflare/read.mjs", import.meta.url), "utf8");
  const migration = fs.readFileSync(new URL("../cloudflare/migrations/0012_product_search_fts.sql", import.meta.url), "utf8");
  const cleanMigration = fs.readFileSync(new URL("../cloudflare/migrations/0013_clean_product_search.sql", import.meta.url), "utf8");
  assert.match(hook, /}, 280\)/);
  assert.match(read, /product_search MATCH \?/);
  assert.match(migration, /tokenize='trigram remove_diacritics 1'/);
  assert.match(cleanMigration, /LIKE 'importado desde excel,%'/);
  assert.match(cleanMigration, /0013_clean_product_search/);
});

test("la búsqueda manual permanece y el escáner limpia el campo", () => {
  const pos = fs.readFileSync(new URL("../src/pages/PointOfSale.jsx", import.meta.url), "utf8");
  assert.match(pos, /if \(scanned\) \{[\s\S]*?setSearch\(""\)/);
  assert.match(pos, /Boolean\(exact\?\.barcode && exact\.barcode === search\.trim\(\)\)/);
  assert.doesNotMatch(pos, /onProduct\(id, index, \(\) => \{\s*setSearch\(""\)/);
});

test("inventario local queda bloqueado y recepción nunca muestra undefined", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const inventory = fs.readFileSync(new URL("../src/pages/AdminPages.jsx", import.meta.url), "utf8");
  const form = fs.readFileSync(new URL("../src/components/OperationForm.jsx", import.meta.url), "utf8");
  assert.match(app, /inventoryWriteActions/);
  assert.match(app, /state\.degraded \|\| !online/);
  assert.match(inventory, /Inventario bloqueado temporalmente/);
  assert.match(inventory, /Buscar movimiento/);
  assert.match(inventory, /Tipo de movimiento/);
  assert.match(form, /: "unidad"/);
  assert.doesNotMatch(form, /Costo por \$\{base\(receiving\?\.unit/);
});

test("clientes muestra búsqueda, fecha de venta y rango de fechas", () => {
  const pages = fs.readFileSync(new URL("../src/pages/AdminPages.jsx", import.meta.url), "utf8");
  assert.match(pages, /name="customer_debt_search"/);
  assert.match(pages, /"Fecha de venta"/);
  assert.match(pages, /saleDate >= debtStart/);
  assert.match(pages, /saleDate <= debtEnd/);
});

test("etiquetas limpian la lista únicamente después de imprimir correctamente", () => {
  const logistics = fs.readFileSync(new URL("../src/pages/Logistics.jsx", import.meta.url), "utf8");
  assert.match(logistics, /await printLabels\(business, html\);\s*setItems\(\[\]\);/);
});

test("las ventas locales conservan detalle para reimprimir sin servidor", () => {
  const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
  const pages = fs.readFileSync(new URL("../src/pages/AdminPages.jsx", import.meta.url), "utf8");
  const printer = fs.readFileSync(new URL("../src/lib/printer.js", import.meta.url), "utf8");
  assert.match(app, /items: saleCart\.map/);
  assert.match(app, /cartTotal,\s*lineTotal,/);
  assert.match(app, /case "print_offline_sale"/);
  assert.match(pages, /Reimprimir recibo local/);
  assert.match(printer, /printOfflineSale/);
  assert.doesNotMatch(printer.match(/export async function printOfflineSale[\s\S]*$/)?.[0] || "", /receipt\.txt/);
});
