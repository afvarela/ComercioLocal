export const methods = [
  "Efectivo",
  "Nequi",
  "Daviplata",
  "Bancolombia",
  "Datáfono",
];
export const unregisteredTypes = ["OTROS", "DULCES DETAL", "PAPELERIA"];
export const cop = (x) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 2,
  }).format((x || 0) / 100);
export function localDate(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function colombiaDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.valueOf())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export const dt = (x) =>
  x
    ? new Date(x).toLocaleString("es-CO", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
export const qty = (q, u) => (["m", "litro", "libra"].includes(u) ? q / 1000 : q);
export const productNeedsWeight = (product) =>
  product?.category === "Verduras" || product?.unit === "g";
export const automaticProductQuantity = (product) =>
  ["m", "litro", "libra"].includes(product?.unit) ? 1000 : 1;
export const stockLabel = (q, u) => `${qty(q, u).toLocaleString("es-CO")} ${u}`;
export const base = (u, basis = 1000) =>
  u === "g" ? (Number(basis) === 500 ? "libra" : "kg") : u;
export const lineTotal = (l) =>
  l.unregistered ? l.total : Math.round(
    (l.qty * l.price) /
      (l.unit === "g"
        ? l.price_basis || 1000
        : ["m", "litro", "libra"].includes(l.unit)
          ? 1000
          : 1),
  );
export const cartTotal = (cart) => cart.reduce((s, l) => s + lineTotal(l), 0);
export const unregisteredLinePayload = (line) => ({
  description: line.name || line.description || "Producto no registrado",
  qty: Number(line.qty),
  price: Number(line.originalPrice ?? line.price ?? 0) / 100,
  discount: Number(line.discount || 0) / 100,
});
export const saleNumber = (s, b) =>
  `${b === 1 ? "MM" : "FE"}-${String(s.number).padStart(6, "0")}`;
export const normalize = (s) =>
  String(s ?? "")
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
