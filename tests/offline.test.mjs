import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
Object.defineProperty(globalThis, "window", { value: { dispatchEvent() {} }, configurable: true });
Object.defineProperty(globalThis, "fetch", { value: async () => { throw new TypeError("offline"); }, configurable: true });

const { api, pendingSales, syncPendingSales } = await import(`../src/lib/api.js?offline-test=${Date.now()}`);

test("usa el estado local si Cloudflare D1 alcanza su limite diario", async () => {
  storage.clear();
  navigator.onLine = true;
  localStorage.setItem("pos-offline-session-v1", "1");
  localStorage.setItem("pos-api-cache-v2", JSON.stringify({
    "1:/api/state": { products: [{ id: 7, name: "Producto guardado", available: 2, stock: 2 }] },
  }));
  Object.defineProperty(globalThis, "fetch", {
    value: async () => new Response(
      JSON.stringify({ error: "Cloudflare D1 alcanzó el límite diario de lecturas." }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    ),
    configurable: true,
  });
  const result = await api(1, "/api/state");
  assert.equal(result.degraded, true);
  assert.equal(result.products[0].name, "Producto guardado");
  navigator.onLine = false;
  Object.defineProperty(globalThis, "fetch", {
    value: async () => { throw new TypeError("offline"); },
    configurable: true,
  });
});

test("una recarga offline usa el ultimo historial aunque cambie la fecha", async () => {
  storage.clear();
  const previous = { sales: [{ id: 9 }], stock_moves: [] };
  localStorage.setItem("pos-api-cache-v2", JSON.stringify({
    "1:/api/history?start=2026-09-17&end=2026-09-17": previous,
  }));
  const result = await api(1, "/api/history?start=2026-09-18&end=2026-09-18");
  assert.deepEqual(result.sales, previous.sales);
  assert.deepEqual(result.stock_moves, previous.stock_moves);
});

test("las ventas offline sobreviven y descuentan la existencia proyectada", async () => {
  storage.clear();
  localStorage.setItem("pos-offline-session-v1", "1");
  localStorage.setItem("pos-api-cache-v2", JSON.stringify({
    "1:/api/state": { products: [{ id: 3, name: "Aceite", unit: "und", available: 10, stock: 10 }] },
  }));
  const sale = {
    action: "sale",
    data: { request_id: "offline-request-123456", lines: [{ product_id: 3, qty: 2 }] },
  };
  const saved = await api(1, "/api/command", sale);
  assert.equal(saved.offline, true);
  assert.equal(pendingSales().length, 1);
  const stateAfterReload = await api(1, "/api/state");
  assert.equal(stateAfterReload.products[0].available, 8);
});

test("no permite vender offline mas unidades que las guardadas", async () => {
  await assert.rejects(
    api(1, "/api/command", {
      action: "sale",
      data: { request_id: "offline-request-654321", lines: [{ product_id: 3, qty: 9 }] },
    }),
    /Existencias insuficientes sin conexión/,
  );
});

test("permite abrir caja offline y conserva la apertura al recargar", async () => {
  storage.clear();
  localStorage.setItem("pos-offline-session-v1", "1");
  localStorage.setItem("pos-api-cache-v2", JSON.stringify({
    "1:/api/state": {
      user: { id: 7, name: "Cajero" },
      cash: null,
      products: [{ id: 3, name: "Aceite", unit: "und", available: 10, stock: 10 }],
    },
    "1:/api/history?start=2026-09-18&end=2026-09-18": { sales: [], cash_sessions: [] },
  }));
  const opened = await api(1, "/api/command", {
    action: "open_cash",
    data: { opening: 50000, note: "Inicio del turno" },
  });
  assert.equal(opened.offline, true);
  assert.equal(pendingSales()[0].action, "open_cash");
  const stateAfterReload = await api(1, "/api/state");
  assert.equal(stateAfterReload.cash.offline, true);
  assert.equal(stateAfterReload.cash.opening, 5_000_000);
  assert.equal(stateAfterReload.cash.user_id, 7);
  assert.equal(stateAfterReload.cash.operator, "Cajero");
  const history = await api(1, "/api/history?start=2026-09-19&end=2026-09-19");
  assert.equal(history.cash_sessions[0].offline, true);
  assert.equal(history.cash_sessions[0].opening, 5_000_000);
});

test("sincroniza primero la apertura y despues las ventas offline", async () => {
  await api(1, "/api/command", {
    action: "sale",
    data: { request_id: "offline-after-opening", lines: [{ product_id: 3, qty: 1 }] },
  });
  const actions = [];
  navigator.onLine = true;
  Object.defineProperty(globalThis, "fetch", {
    value: async (_url, options) => {
      actions.push(JSON.parse(options.body).action);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
    configurable: true,
  });
  const result = await syncPendingSales();
  assert.deepEqual(actions, ["open_cash", "sale"]);
  assert.deepEqual(result, { synced: 2, pending: 0 });
  assert.equal(pendingSales().length, 0);
});

test("permite iniciar sesion offline solo con un PIN validado previamente", async () => {
  storage.clear();
  navigator.onLine = true;
  Object.defineProperty(globalThis, "fetch", {
    value: async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    configurable: true,
  });
  await api(1, "/api/login", { username: "cajero", password: "1234" });
  await api(1, "/api/logout", {});
  navigator.onLine = false;
  const logged = await api(1, "/api/login", { username: "CAJERO", password: "1234" });
  assert.equal(logged.offline, true);
  assert.equal(localStorage.getItem("pos-offline-session-v1"), "1");
  await assert.rejects(
    api(1, "/api/login", { username: "cajero", password: "9999" }),
    /Usuario o PIN incorrecto/,
  );
});

test("muestra las ventas locales pendientes dentro del historial", async () => {
  storage.clear();
  Object.defineProperty(globalThis, "fetch", {
    value: async () => { throw new TypeError("offline"); },
    configurable: true,
  });
  localStorage.setItem("pos-offline-session-v1", "1");
  localStorage.setItem("pos-api-cache-v2", JSON.stringify({
    "1:/api/state": { user: { name: "Ana" }, products: [{ id: 3, name: "Aceite", unit: "und", available: 10, stock: 10 }] },
    "1:/api/history?start=2026-09-18&end=2026-09-18": { sales: [], stock_moves: [] },
  }));
  await api(1, "/api/command", {
    action: "sale",
    data: {
      request_id: "offline-visible-sale",
      lines: [{ product_id: 3, qty: 1 }],
      payments: [{ method: "Efectivo", amount: 7500 }],
      _offline: { total: 7500, operator: "Ana", customer: null },
    },
  });
  const history = await api(1, "/api/history?start=2026-09-19&end=2026-09-19");
  assert.equal(history.sales[0].offline, true);
  assert.equal(history.sales[0].status, "local");
  assert.equal(history.sales[0].total, 7500);
});

test("los estados de despacho cambian y quedan pendientes de sincronizar sin internet", async () => {
  storage.clear();
  navigator.onLine = false;
  Object.defineProperty(globalThis, "fetch", {
    value: async () => { throw new TypeError("offline"); },
    configurable: true,
  });
  localStorage.setItem("pos-api-cache-v2", JSON.stringify({
    "1:/api/logistics": { dispatches: [{ id: 21, status: "Pendiente" }], sales: [], products: [] },
  }));
  const saved = await api(1, "/api/logistics-command", {
    action: "status",
    data: { id: 21, status: "Entregado", lines: [] },
  });
  assert.equal(saved.offline, true);
  assert.equal(pendingSales()[0].action, "logistics_status");
  const state = await api(1, "/api/logistics");
  assert.equal(state.dispatches[0].status, "Entregado");
  assert.equal(state.dispatches[0].offline, true);
});
