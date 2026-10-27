import { methods } from "./format.js";
export function cents(value) {
  const v = Number(value || 0);
  return Number.isFinite(v) ? Math.round(v * 100) : 0;
}
export function paymentState(total, values) {
  const electronic = methods.slice(1).reduce((s, m) => s + cents(values[m]), 0);
  const cash = cents(values.Efectivo),
    paid = cash + electronic;
  return {
    electronic,
    cash,
    paid,
    remaining: Math.max(0, total - paid),
    change: Math.max(0, paid - total),
    excessElectronic: electronic > total,
  };
}
// Editing any non-cash field redistributes only the cash remainder.
// Other electronic entries stay intact. Cash may then be edited for tender/change or credit.
export function updatePayment(total, values, method, value) {
  const next = { ...values, [method]: value };
  if (method !== "Efectivo") {
    const electronic = methods.slice(1).reduce((s, m) => s + cents(next[m]), 0);
    next.Efectivo = String(Math.max(0, total - electronic) / 100);
  }
  return next;
}
export const initialPayments = (total) =>
  Object.fromEntries(
    methods.map((m) => [m, m === "Efectivo" ? String(total / 100) : ""]),
  );

export function keypadValue(current, key, replace = false) {
  if (key === "⌫") return String(current || "").slice(0, -1);
  const digits = String(current || "").replace(/\D/g, "");
  const next = replace ? key : digits + key;
  return String(Math.min(999999999, Number(next || 0)));
}
