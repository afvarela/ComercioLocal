const CACHE = "pos-api-cache-v2";
const QUEUE = "pos-offline-sales-v2";
const AUTH = "pos-offline-auth-v1";
const LOCAL_SESSION = "pos-offline-session-v1";
const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
};
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const cacheKey = (business, path) => `${business}:${path}`;
const offlineAction = (path, data) => path === "/api/command" ? data?.action : path === "/api/logistics-command" && data?.action === "status" ? "logistics_status" : "";
const isOfflineSale = (path, data) => offlineAction(path, data) === "sale" && data?.data?.request_id;
const isOfflineOperation = (path, data) => ["sale", "open_cash", "logistics_status"].includes(offlineAction(path, data));
export const pendingSales = () => read(QUEUE, []);

async function pinVerifier(username, pin) {
  const bytes = new TextEncoder().encode(`comercio-local:${String(username).trim().toLowerCase()}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function saveOfflineLogin(data) {
  write(AUTH, { username: String(data.username || "").trim().toLowerCase(), verifier: await pinVerifier(data.username, data.password) });
  localStorage.setItem(LOCAL_SESSION, "1");
}

async function offlineLogin(data) {
  const saved = read(AUTH, null);
  if (!saved || saved.username !== String(data.username || "").trim().toLowerCase() || saved.verifier !== await pinVerifier(data.username, data.password)) {
    const error = Error("Usuario o PIN incorrecto. Para habilitar el acceso local, inicia sesión una vez con internet.");
    error.status = 401;
    throw error;
  }
  localStorage.setItem(LOCAL_SESSION, "1");
  return { ok: true, offline: true };
}

function latestCached(cache, business, path) {
  const exact = cache[cacheKey(business, path)];
  if (exact !== undefined) return exact;
  if (!path.startsWith("/api/history?")) return undefined;
  const prefix = `${business}:/api/history?`;
  const latest = Object.keys(cache).filter((key) => key.startsWith(prefix)).sort().at(-1);
  return latest ? cache[latest] : undefined;
}

function projectedState(value, business) {
  if (!value?.products) return value;
  const state = structuredClone(value);
  for (const sale of pendingSales().filter((item) => item.business === business)) {
    for (const line of sale.data?.data?.lines || []) {
      const product = state.products.find((item) => item.id === Number(line.product_id));
      if (!product) continue;
      const amount = Number(line.qty) * (product.unit === "m" ? 1000 : 1);
      product.available = Math.max(0, Number(product.available) - amount);
      product.stock = Math.max(0, Number(product.stock) - amount);
    }
    if (sale.action === "sale" && sale.data?.data?.customer_id) {
      const customer = state.customers?.find((item) => item.id === Number(sale.data.data.customer_id));
      if (customer) {
        customer.total_purchases = Number(customer.total_purchases || 0) + Number(sale.data.data._offline?.total || 0);
        customer.purchase_count = Number(customer.purchase_count || 0) + 1;
      }
    }
  }
  return state;
}

function projectedHistory(value, business) {
  if (!value?.sales) return value;
  const history = structuredClone(value);
  const cache = read(CACHE, {}), state = cache[cacheKey(business, "/api/state")];
  history.cash_sessions ||= [];
  const localOpenings = pendingSales().filter((item) => item.business === business && item.action === "open_cash");
  for (const item of localOpenings) {
    if (history.cash_sessions.some((cash) => String(cash.id) === String(item.requestId))) continue;
    const opening = Math.round(Number(item.data.data.opening || 0) * 100);
    history.cash_sessions.unshift({
      id: item.requestId,
      opened: item.created,
      opening,
      expected: opening,
      counted: null,
      closed: null,
      operator: state?.user?.name || "Usuario local",
      note: item.data.data.note || "Apertura guardada sin conexión",
      offline: true,
    });
  }
  const localSales = pendingSales().filter((item) => item.business === business && item.action === "sale");
  for (const item of localSales) {
    if (history.sales.some((sale) => sale.request_id === item.requestId)) continue;
    const meta = item.data.data._offline || {};
    const paid = (item.data.data.payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const total = Number(meta.total || 0);
    history.sales.unshift({
      id: item.requestId, request_id: item.requestId, number: "LOCAL", created: item.created,
      operator: meta.operator || state?.user?.name || "Usuario local",
      customer: meta.customer || null, total, cost: 0,
      debt: Math.max(0, total - paid), original_debt: Math.max(0, total - paid),
      status: "local", offline: true,
    });
  }
  return history;
}

function validateOfflineStock(business, data) {
  const cache = read(CACHE, {});
  const base = cache[cacheKey(business, "/api/state")];
  if (!base?.products) return;
  const state = projectedState(base, business);
  for (const line of data.data.lines || []) {
    const product = state.products.find((item) => item.id === Number(line.product_id));
    if (!product) throw Error("El producto no está disponible en la copia sin conexión");
    const amount = Number(line.qty) * (product.unit === "m" ? 1000 : 1);
    if (amount > Number(product.available))
      throw Error(`Existencias insuficientes sin conexión: ${product.name}`);
  }
}

function enqueueOperation(business, path, data, reason) {
  const queue = pendingSales();
  const action = offlineAction(path, data);
  const requestId = data.data.request_id || `${action}-${crypto.randomUUID()}`;
  if (action === "sale") validateOfflineStock(business, data);
  if (action === "open_cash") {
    const cache = read(CACHE, {}), key = cacheKey(business, "/api/state"), state = cache[key];
    if (!state) throw Error("Abre la aplicación con Internet al menos una vez antes de trabajar sin conexión");
    if (state.cash) throw Error("Ya hay una caja abierta en este dispositivo");
    state.cash = {
      id: requestId,
      user_id: state.user?.id,
      opened: new Date().toISOString(),
      opening: Math.round(Number(data.data.opening || 0) * 100),
      expected: Math.round(Number(data.data.opening || 0) * 100),
      operator: state.user?.name || "Usuario local",
      note: data.data.note || "Apertura guardada sin conexión",
      offline: true,
    };
    cache[key] = state;
    write(CACHE, cache);
  }
  if (action === "logistics_status") {
    const cache = read(CACHE, {}), key = cacheKey(business, "/api/logistics"), logistics = cache[key];
    const dispatch = logistics?.dispatches?.find((item) => item.id === Number(data.data.id));
    if (!dispatch) throw Error("El despacho no está disponible en la copia sin conexión");
    dispatch.status = data.data.status;
    dispatch.offline = true;
    cache[key] = logistics;
    write(CACHE, cache);
  }
  if (!queue.some((item) => item.requestId === requestId))
    queue.push({ business, path, data, action, requestId, created: new Date().toISOString(), error: reason });
  write(QUEUE, queue);
  window.dispatchEvent(new Event("pos-queue-change"));
  return { offline: true, id: requestId, change: 0 };
}

async function request(business, path, data) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(`${path}${path.includes("?") ? "&" : "?"}business=${business}`, {
      method: data === undefined ? "GET" : "POST",
      headers: data === undefined ? {} : { "Content-Type": "application/json", "X-POS-Request": "1" },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
  let result;
  try { result = await response.json(); } catch { result = { error: "Respuesta inválida del servidor" }; }
  if (!response.ok) {
    const error = Error(result.error || "No se pudo completar la operación");
    error.status = response.status;
    throw error;
  }
  return result;
}

export async function api(business, path, data) {
  if (path === "/api/login" && data && !navigator.onLine) return offlineLogin(data);
  if (path === "/api/logout" && data && !navigator.onLine) {
    localStorage.removeItem(LOCAL_SESSION);
    return { ok: true, offline: true };
  }
  try {
    const result = await request(business, path, data);
    if (path === "/api/login" && data) await saveOfflineLogin(data);
    if (path === "/api/logout") localStorage.removeItem(LOCAL_SESSION);
    if (data === undefined) {
      const cache = read(CACHE, {});
      cache[cacheKey(business, path)] = result;
      write(CACHE, cache);
      if (path === "/api/state") localStorage.setItem(LOCAL_SESSION, "1");
    }
    return result;
  } catch (error) {
    if (path === "/api/login" && data && !error.status) return offlineLogin(data);
    if (path === "/api/logout" && data && !error.status) {
      localStorage.removeItem(LOCAL_SESSION);
      return { ok: true, offline: true };
    }
    if (isOfflineOperation(path, data) && (!navigator.onLine || !error.status)) return enqueueOperation(business, path, data, error.message);
    if (data === undefined && (!navigator.onLine || !error.status)) {
      const cached = latestCached(read(CACHE, {}), business, path);
      if (cached !== undefined) {
        if (path === "/api/state" && localStorage.getItem(LOCAL_SESSION) !== "1") {
          const denied = Error("Inicia sesión con tu usuario y PIN para trabajar sin internet");
          denied.status = 401;
          throw denied;
        }
        if (path === "/api/state") return projectedState(cached, business);
        if (path.startsWith("/api/history?")) return projectedHistory(cached, business);
        return cached;
      }
    }
    if (!error.status) throw Error("No se puede conectar con el servidor. Los datos ya cargados siguen disponibles.");
    throw error;
  }
}

export async function downloadInvoicePdf(id, number = id) {
  const response = await fetch(`/invoice.pdf?business=2&id=${encodeURIComponent(id)}`);
  const contentType = String(response.headers.get("Content-Type") || "").toLowerCase();
  if (!response.ok || !contentType.includes("application/pdf")) {
    let message = "No fue posible generar la factura PDF";
    try {
      const body = await response.clone().json();
      if (body?.error) message = body.error;
    } catch {
      const body = (await response.text()).trim();
      if (body && body !== "No encontrado") message = body;
    }
    throw Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `factura-ferreteria-${String(number).padStart(6, "0")}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function syncPendingSales() {
  const queue = pendingSales(), remaining = [];
  let synced = 0;
  for (let index = 0; index < queue.length; index += 1) {
    const item = queue[index];
    try { await request(item.business, item.path, item.data); synced += 1; }
    catch (error) {
      if (item.action === "open_cash" && error.status === 400 && /caja abierta/i.test(error.message)) {
        synced += 1;
        continue;
      }
      remaining.push({ ...item, error: error.message });
      if (!error.status) { remaining.push(...queue.slice(index + 1)); break; }
    }
  }
  write(QUEUE, remaining);
  window.dispatchEvent(new Event("pos-queue-change"));
  return { synced, pending: remaining.length };
}
