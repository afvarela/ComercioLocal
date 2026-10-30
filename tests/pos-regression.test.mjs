import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { validateInventoryQuantity } from "../src/lib/cartInventory.js";

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
