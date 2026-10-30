import test from "node:test";
import assert from "node:assert/strict";
import {
  lineTotal,
  cartTotal,
  productNeedsWeight,
  automaticProductQuantity,
  unregisteredLinePayload,
  unregisteredTypes,
} from "../src/lib/format.js";

test("dos litros a 4000 cuestan 8000", () => {
  const milk = { unit: "litro", qty: 2000, price: 400000, price_basis: 1000 };
  assert.equal(lineTotal(milk), 800000);
  assert.equal(cartTotal([milk]), 800000);
});

test("dos libras a 12000 cuestan 24000", () => {
  const cheese = { unit: "libra", qty: 2000, price: 1200000, price_basis: 1000 };
  assert.equal(lineTotal(cheese), 2400000);
});

test("los productos normales se agregan automáticamente con cantidad uno", () => {
  const product = { category: "Abarrotes", unit: "und" };
  assert.equal(productNeedsWeight(product), false);
  assert.equal(automaticProductQuantity(product), 1);
});

test("las verduras siempre solicitan el peso", () => {
  assert.equal(productNeedsWeight({ category: "Verduras", unit: "g" }), true);
  assert.equal(productNeedsWeight({ category: "Verduras", unit: "und" }), true);
});

test("una unidad de litro, libra o metro usa la cantidad interna correcta", () => {
  assert.equal(automaticProductQuantity({ unit: "litro" }), 1000);
  assert.equal(automaticProductQuantity({ unit: "libra" }), 1000);
  assert.equal(automaticProductQuantity({ unit: "m" }), 1000);
});

test("un producto sin registrar conserva su precio al enviarse a la venta", () => {
  const line = {
    unregistered: true,
    name: "Producto no registrado",
    qty: 2,
    originalPrice: 400000,
    discount: 0,
    total: 800000,
  };
  assert.deepEqual(unregisteredLinePayload(line), {
    description: "Producto no registrado",
    qty: 2,
    price: 4000,
    discount: 0,
  });
  assert.equal(cartTotal([line]), 800000);
});

test("producto no registrado usa únicamente el listado fijo solicitado", () => {
  assert.deepEqual(unregisteredTypes, ["OTROS", "DULCES DETAL", "PAPELERIA"]);
  const payload = unregisteredLinePayload({
    unregistered: true,
    name: "DULCES DETAL",
    qty: 1,
    originalPrice: 250000,
    discount: 0,
  });
  assert.equal(payload.description, "DULCES DETAL");
});
