import test from "node:test";
import assert from "node:assert/strict";
import {
  initialPayments,
  updatePayment,
  paymentState,
  keypadValue,
} from "../src/lib/payments.js";
test("el teclado numérico reemplaza el total inicial con el primer dígito", () => {
  assert.equal(keypadValue("5000", "1", true), "1");
  assert.equal(keypadValue("1", "00"), "100");
  assert.equal(keypadValue("100", "⌫"), "10");
});
test("todo inicia en efectivo", () =>
  assert.equal(initialPayments(100000).Efectivo, "1000"));
test("500 de Nequi reduce efectivo de 1000 a 500", () => {
  const v = updatePayment(100000, initialPayments(100000), "Nequi", "500");
  assert.equal(v.Efectivo, "500");
  assert.equal(paymentState(100000, v).remaining, 0);
});
test("varios medios restan del efectivo sin modificar los demás", () => {
  let v = initialPayments(100000);
  v = updatePayment(100000, v, "Nequi", "300");
  v = updatePayment(100000, v, "Daviplata", "200");
  v = updatePayment(100000, v, "Bancolombia", "100");
  v = updatePayment(100000, v, "Datáfono", "150");
  assert.equal(v.Efectivo, "250");
  assert.equal(v.Nequi, "300");
  assert.equal(paymentState(100000, v).paid, 100000);
});
test("borrar un medio restaura su parte en efectivo", () => {
  let v = updatePayment(100000, initialPayments(100000), "Nequi", "500");
  v = updatePayment(100000, v, "Nequi", "");
  assert.equal(v.Efectivo, "1000");
});
test("efectivo recibido mayor permite calcular cambio", () => {
  let v = updatePayment(100000, initialPayments(100000), "Nequi", "500");
  v = updatePayment(100000, v, "Efectivo", "1000");
  assert.equal(paymentState(100000, v).change, 50000);
});
test("reducción manual de efectivo deja faltante para fiado", () => {
  let v = updatePayment(100000, initialPayments(100000), "Efectivo", "300");
  assert.equal(paymentState(100000, v).remaining, 70000);
});
test("excedente electrónico se marca, nunca crea efectivo negativo", () => {
  const v = updatePayment(100000, initialPayments(100000), "Nequi", "1500");
  assert.equal(v.Efectivo, "0");
  assert.equal(paymentState(100000, v).excessElectronic, true);
});
test("centavos no producen diferencia por error binario", () => {
  let v = updatePayment(100030, initialPayments(100030), "Nequi", "500.10");
  v = updatePayment(100030, v, "Daviplata", "0.20");
  assert.equal(v.Efectivo, "500");
  assert.equal(paymentState(100030, v).remaining, 0);
});
