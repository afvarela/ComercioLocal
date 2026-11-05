import test from "node:test";
import assert from "node:assert/strict";

class MemoryStorage {
  constructor() { this.values = new Map(); this.failKey = null; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { if (key === this.failKey) throw new Error("cuota llena"); this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: { onLine: false }, configurable: true });
Object.defineProperty(globalThis, "window", { value: { dispatchEvent() {} }, configurable: true });
Object.defineProperty(globalThis, "fetch", { value: async () => { throw new TypeError("offline"); }, configurable: true });

const { api, pendingSales, savedLocalSale, syncPendingSales } = await import(`../src/lib/api.js?offline-test=${Date.now()}`);

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

test("una recarga offline no mezcla ventas de otra fecha", async () => {
  storage.clear();
  const previous = { sales: [{ id: 9 }], stock_moves: [] };
  localStorage.setItem("pos-api-cache-v2", JSON.stringify({
    "1:/api/history?start=2026-09-17&end=2026-09-17": previous,
  }));
  const result = await api(1, "/api/history?start=2026-09-18&end=2026-09-18");
  assert.deepEqual(result.sales, []);
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

test("repetir la misma venta offline no duplica cola ni inventario", async () => {
  const sale = {
    action: "sale",
    data: { request_id: "offline-request-123456", lines: [{ product_id: 3, qty: 2 }] },
  };
  const repeated = await api(1, "/api/command", sale);
  assert.equal(repeated.duplicate, true);
  assert.equal(pendingSales().filter(item => item.requestId === "offline-request-123456").length, 1);
  const stateAfterRepeat = await api(1, "/api/state");
  assert.equal(stateAfterRepeat.products[0].available, 8);
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
  const openingDay = pendingSales()[0].localDay;
  const history = await api(1, `/api/history?start=${openingDay}&end=${openingDay}`);
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
  const saleDay = pendingSales().find((item) => item.action === "sale").localDay;
  const history = await api(1, `/api/history?start=${saleDay}&end=${saleDay}`);
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

test("crea un fiador local, registra la venta fiada y sincroniza sin duplicar referencias", async () => {
  storage.clear();
  navigator.onLine = false;
  Object.defineProperty(globalThis, "fetch", {
    value: async () => { throw new TypeError("offline"); },
    configurable: true,
  });
  localStorage.setItem("pos-offline-session-v1", "1");
  localStorage.setItem("pos-api-cache-v2", JSON.stringify({
    "1:/api/state": {
      user: { id: 7, name: "Ana" },
      cash: { id: 4, user_id: 7 },
      products: [{ id: 3, name: "Aceite", unit: "und", available: 10, stock: 10 }],
      customers: [],
    },
    "1:/api/history?start=2026-11-02&end=2026-11-02": { sales: [], debts: [], receivable_moves: [] },
  }));
  const customerRequest = "offline-customer-123456789";
  const customer = await api(1, "/api/command", {
    action: "customer",
    data: { name: "Cliente local", document: "12345", credit_limit: "", request_id: customerRequest },
  });
  assert.equal(customer.offline, true);
  assert.ok(Number(customer.id) < 0);

  const saleRequest = "offline-credit-sale-123456";
  const sale = await api(1, "/api/command", {
    action: "sale",
    data: {
      request_id: saleRequest,
      customer_id: customer.id,
      allow_credit: true,
      due: "2026-11-20",
      lines: [{ product_id: 3, qty: 1 }],
      payments: [{ method: "Efectivo", amount: 0 }],
      _offline: { total: 500000, operator: "Ana", customer: "Cliente local" },
    },
  });
  assert.equal(sale.offline, true);
  const localState = await api(1, "/api/state");
  assert.equal(localState.customers[0].balance, 500000);
  const saleDay = pendingSales().find((item) => item.requestId === saleRequest).localDay;
  const localHistory = await api(1, `/api/history?start=${saleDay}&end=${saleDay}`);
  assert.equal(localHistory.debts[0].customer, "Cliente local");
  assert.equal(localHistory.debts[0].debt, 500000);

  const calls = [];
  navigator.onLine = true;
  Object.defineProperty(globalThis, "fetch", {
    value: async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(structuredClone(body));
      const id = body.action === "customer" ? 45 : 99;
      return new Response(JSON.stringify({ ok: true, id }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
    configurable: true,
  });
  const synced = await syncPendingSales();
  assert.deepEqual(calls.map((body) => body.action), ["customer", "sale"]);
  assert.equal(calls[1].data.customer_id, 45);
  assert.deepEqual(synced, { synced: 2, pending: 0 });
  assert.equal(pendingSales().length, 0);
});

test("una respuesta 503 guarda la venta en la cola local", async () => {
  storage.clear();
  navigator.onLine = true;
  localStorage.setItem("pos-api-cache-v2", JSON.stringify({
    "1:/api/state": { products: [{ id: 3, name: "Aceite", unit: "und", available: 2, stock: 2 }], customers: [] },
  }));
  Object.defineProperty(globalThis, "fetch", {
    value: async () => new Response(JSON.stringify({ error: "D1 temporalmente no disponible" }), { status: 503, headers: { "Content-Type": "application/json" } }),
    configurable: true,
  });
  const result = await api(1, "/api/command", {
    action: "sale",
    data: { request_id: "d1-paused-sale-123456", lines: [{ product_id: 3, qty: 1 }], payments: [], _offline: { total: 1000 } },
  });
  assert.equal(result.offline, true);
  assert.equal(pendingSales()[0].requestId, "d1-paused-sale-123456");
});

test("el historial en línea también muestra inmediatamente la venta local pendiente", async () => {
  storage.clear();
  navigator.onLine = false;
  Object.defineProperty(globalThis, "fetch", { value: async () => { throw new TypeError("offline"); }, configurable: true });
  localStorage.setItem("pos-api-cache-v2", JSON.stringify({
    "1:/api/state": { user: { name: "Ana" }, products: [{ id: 3, name: "Aceite", unit: "und", available: 2, stock: 2 }] },
  }));
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  await api(1, "/api/command", {
    action: "sale",
    data: { request_id: "online-history-local-123456", lines: [{ product_id: 3, qty: 1 }], payments: [{ method: "Efectivo", amount: 2000 }], _offline: { total: 200000 } },
  });
  navigator.onLine = true;
  Object.defineProperty(globalThis, "fetch", {
    value: async () => new Response(JSON.stringify({ sales: [], debts: [], cash_sessions: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    configurable: true,
  });
  const history = await api(1, `/api/history?start=${day}&end=${day}`);
  assert.equal(history.sales.length, 1);
  assert.equal(history.sales[0].request_id, "online-history-local-123456");
  assert.equal(history.sales[0].offline, true);
});

test("una venta confirmada por D1 sigue visible si luego falla la consulta del historial", async () => {
  storage.clear();
  navigator.onLine = true;
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  localStorage.setItem("pos-api-cache-v2", JSON.stringify({
    [`1:/api/history?start=${day}&end=${day}`]: { sales: [], debts: [], cash_sessions: [] },
  }));
  Object.defineProperty(globalThis, "fetch", {
    value: async (_url, options) => options?.method === "POST"
      ? new Response(JSON.stringify({ ok: true, id: 77 }), { status: 200, headers: { "Content-Type": "application/json" } })
      : new Response(JSON.stringify({ error: "D1 temporalmente no disponible" }), { status: 503, headers: { "Content-Type": "application/json" } }),
    configurable: true,
  });
  const saved = await api(1, "/api/command", {
    action: "sale",
    data: { request_id: "online-saved-sale-123456", lines: [], payments: [{ method: "Nequi", amount: 3000 }], _offline: { total: 300000, operator: "Ana", items: [{ name: "Otro", qty: 1, unit: "und", price: 300000, total: 300000 }] } },
  });
  assert.equal(saved.id, 77);
  const history = await api(1, `/api/history?start=${day}&end=${day}`);
  assert.equal(history.sales.length, 1);
  assert.equal(history.sales[0].id, 77);
  assert.equal(history.sales[0].request_id, "online-saved-sale-123456");
  assert.equal(history.sales[0].synced_local, true);
});

test("una venta sincronizada permanece visible hasta que D1 la confirme en el historial", async () => {
  storage.clear();
  navigator.onLine = false;
  Object.defineProperty(globalThis, "fetch", { value: async () => { throw new TypeError("offline"); }, configurable: true });
  localStorage.setItem("pos-api-cache-v2", JSON.stringify({
    "1:/api/state": { user: { name: "Ana" }, products: [{ id: 3, name: "Aceite", unit: "und", available: 2, stock: 2 }] },
  }));
  await api(1, "/api/command", {
    action: "sale",
    data: { request_id: "synced-history-sale-123456", lines: [{ product_id: 3, qty: 1 }], payments: [{ method: "Efectivo", amount: 2000 }], _offline: { total: 200000 } },
  });
  navigator.onLine = true;
  Object.defineProperty(globalThis, "fetch", {
    value: async (_url, options) => new Response(JSON.stringify(options?.method === "POST" ? { ok: true, id: 91 } : { sales: [], debts: [], cash_sessions: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    configurable: true,
  });
  const synced = await syncPendingSales();
  assert.equal(synced.pending, 0);
  assert.equal(pendingSales().length, 0);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const first = await api(1, `/api/history?start=${day}&end=${day}`);
  assert.equal(first.sales.length, 1);
  assert.equal(first.sales[0].id, 91);
  assert.equal(first.sales[0].synced_local, true);

  Object.defineProperty(globalThis, "fetch", {
    value: async () => new Response(JSON.stringify({ sales: [{ id: 91, number: 91, request_id: "synced-history-sale-123456", created: new Date().toISOString(), total: 200000, status: "active" }], debts: [], cash_sessions: [] }), { status: 200, headers: { "Content-Type": "application/json" } }),
    configurable: true,
  });
  const confirmed = await api(1, `/api/history?start=${day}&end=${day}`);
  assert.equal(confirmed.sales.length, 1);
  assert.equal(confirmed.sales[0].synced_local, undefined);
  assert.equal(confirmed.sales[0].local_copy, true);
  assert.equal(savedLocalSale(1, "synced-history-sale-123456").syncedId, 91);
});

test("no informa venta local exitosa si el navegador no logra guardar la cola", async () => {
  storage.clear();
  navigator.onLine = false;
  Object.defineProperty(globalThis, "fetch", { value: async () => { throw new TypeError("offline"); }, configurable: true });
  localStorage.setItem("pos-api-cache-v2", JSON.stringify({
    "1:/api/state": { products: [{ id: 3, name: "Aceite", unit: "und", available: 2, stock: 2 }] },
  }));
  storage.failKey = "pos-offline-sales-v2";
  await assert.rejects(
    api(1, "/api/command", { action: "sale", data: { request_id: "unsafe-local-sale-123456", lines: [{ product_id: 3, qty: 1 }], payments: [], _offline: { total: 1000 } } }),
    /No fue posible guardar la operación de forma segura/,
  );
  storage.failKey = null;
});
