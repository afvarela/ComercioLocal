import test from "node:test";
import assert from "node:assert/strict";
import { matchesProductSearch } from "../src/lib/productSearch.js";

const product = {
  name: "SHAMPOO JOHNSONS ORIGINAL 25ML",
  sku: "TDESC-00737",
  barcode: "7701234567890",
  description: "Línea para niños",
  category: "Importación Excel",
};

test("encuentra una palabra ubicada en la mitad del nombre", () => {
  assert.equal(matchesProductSearch(product, "ORIGINAL"), true);
});

test("encuentra varias palabras sin exigir el orden del nombre", () => {
  assert.equal(matchesProductSearch(product, "original shampoo"), true);
});

test("acepta asteriscos para separar fragmentos recordados", () => {
  assert.equal(matchesProductSearch(product, "SHA* ORI*"), true);
  assert.equal(matchesProductSearch(product, "JOHN* 25M*"), true);
});

test("ignora mayúsculas, tildes y signos", () => {
  assert.equal(matchesProductSearch(product, "linea ninos"), true);
});

test("encuentra coincidencias parciales de SKU y código de barras", () => {
  assert.equal(matchesProductSearch(product, "0737 4567"), true);
});

test("descarta productos sin ninguna coincidencia", () => {
  assert.equal(matchesProductSearch(product, "acondicionador"), false);
});

test("no confunde UM original del Excel con el nombre comercial", () => {
  const imported = {
    name: "ACEITE BEBE JUNIORS 50ml",
    sku: "TDESC-01099",
    description: "Importado desde Excel, fila 1099. UM original: un",
    category: "Importacion Excel",
  };
  assert.equal(matchesProductSearch(imported, "ORIGINAL"), false);
  assert.equal(matchesProductSearch(imported, "JUNIORS"), true);
});
