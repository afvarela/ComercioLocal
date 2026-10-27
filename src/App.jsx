import React, { useEffect, useRef, useState } from "react";
import { api, downloadInvoicePdf, pendingSales, syncPendingSales } from "./lib/api.js";
import { printReceipt, printOfflineSale } from "./lib/printer.js";
import {
  cop,
  cartTotal,
  qty,
  localDate,
  uid,
  productNeedsWeight,
  automaticProductQuantity,
  unregisteredLinePayload,
} from "./lib/format.js";
import { Button, Field, Badge } from "./components/UI.jsx";
import PointOfSale from "./pages/PointOfSale.jsx";
import Accounting from "./pages/Accounting.jsx";
import Dairy from "./pages/Dairy.jsx";
import {
  Inventory,
  Customers,
  Guarantors,
  Cash,
  Sales,
  Quotes,
  Reports,
  Settings,
} from "./pages/AdminPages.jsx";
import Checkout from "./components/Checkout.jsx";
import OperationForm from "./components/OperationForm.jsx";
import Receipt from "./components/Receipt.jsx";
import LetterInvoice from "./components/LetterInvoice.jsx";
import { Dispatches, Labels } from "./pages/Logistics.jsx";
const navigation = [
  ["pos", "▦", "Punto de venta"],
  ["vegetables", "❧", "Verduras"],
  ["sales", "▤", "Ventas y recibos"],
  ["dispatches", "D", "Despachos"],
  ["labels", "E", "Impresión de etiquetas"],
  ["inventory", "▥", "Inventario"],
  ["customers", "♧", "Clientes y fiados"],
  ["cash", "▣", "Caja y arqueo"],
  ["dairy", "L", "Control de lácteos"],
  ["accounting", "$", "Contabilidad y Finanzas"],
  ["quotes", "▧", "Cotizaciones"],
  ["reports", "◷", "Reportes"],
  ["settings", "⚙", "Configuración"],
];
function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark">▦</span>
      <span>
        Comercio Local<small>Portal negocios.</small>
      </span>
    </div>
  );
}
function Auth({ setup, onLogin }) {
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  return (
    <div className="auth">
      <section className="auth-story">
        <Brand />
        <div className="pill">Mini market + Ferretería</div>
        <h1>
          All in one
          <br />
          business.
        </h1>
        <p>
          Una caja sencilla. Inventarios que cuentan la historia completa. Cada
          negocio con sus propias cuentas.
        </p>
        <div className="status" style={{ color: "#d2e8d3", marginTop: 35 }}>
          Funciona en tu computador, sin internet.
        </div>
      </section>
      <section className="auth-form">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (loading) return;
            const d = Object.fromEntries(new FormData(e.currentTarget));
            setLoading(true);
            setError("");
            try {
              await onLogin(d, setup);
            } catch (e) {
              setError(e.message);
            } finally {
              setLoading(false);
            }
          }}
        >
          <h2>{setup ? "Prepara tu punto de venta" : "Bienvenido de nuevo"}</h2>
          <p>
            {setup
              ? "Crea la cuenta administradora y prepara tus negocios para empezar a vender."
              : "Ingresa con tu usuario para abrir caja y empezar a vender."}
          </p>
          {error && (
            <div
              className="form-error"
              style={{ display: "block" }}
              role="alert"
            >
              {error}
            </div>
          )}
          {setup && (
            <Field name="name" label="Tu nombre" required autoComplete="name" />
          )}
          <Field
            name="username"
            label="Usuario"
            required
            autoComplete="username"
          />
          <Field
            name="password"
            label={setup ? "PIN de acceso · 4 números" : "PIN de acceso"}
            type="password"
            required
            inputMode="numeric"
            pattern="[0-9]{4}"
            minLength="4"
            maxLength="4"
            autoComplete={setup ? "new-password" : "current-password"}
          />
          <Button primary disabled={loading}>
            {loading
              ? "Entrando…"
              : setup
                ? "Crear administrador"
                : "Entrar al negocio"}
          </Button>
          <p style={{ marginTop: 22, fontSize: 12 }}>
            Los datos se guardan en la base de datos local de este computador.
          </p>
        </form>
      </section>
    </div>
  );
}
export default function App() {
  const [business, setBusiness] = useState(() =>
      Number(sessionStorage.getItem("business") || 1),
    ),
    [state, setState] = useState(null),
    [history, setHistory] = useState(null),
    [setup, setSetup] = useState(null),
    [failure, setFailure] = useState(""),
    [view, setView] = useState("pos"),
    [cart, setCart] = useState([]),
    [quoteId, setQuoteId] = useState(null),
    [customerId, setCustomerId] = useState(""),
    [modal, setModal] = useState(null),
    [message, setMessage] = useState(""),
    [start, setStart] = useState(localDate()),
    [end, setEnd] = useState(localDate()),
    [focusKey, setFocusKey] = useState(0),
    [switching, setSwitching] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [pending, setPending] = useState(() => pendingSales().length),
    [dispatchSaleId, setDispatchSaleId] = useState(null),
    [parkedSales,setParkedSales]=useState(()=>{try{return JSON.parse(localStorage.getItem("pos-parked-sales-v1")||"[]")}catch{return []}});
  const requestId = useRef(uid()),
    toastTimer = useRef(null),
    switchLock = useRef(false);
  const admin = state?.user.role === "admin";
  useEffect(()=>localStorage.setItem("pos-parked-sales-v1",JSON.stringify(parkedSales)),[parkedSales]);
  function newSale() {
    if(cart.length){const draft={id:uid(),business,cart,customerId,quoteId,requestId:requestId.current,created:new Date().toISOString()};setParkedSales(x=>[...x,draft]);toast(`Venta guardada en espera con ${cart.length} producto(s)`)}
    setCart([]);setCustomerId("");setQuoteId(null);requestId.current=uid();setView("pos");setFocusKey(x=>x+1);
  }
  function resumeSale(id){
    const selected=parkedSales.find(x=>x.id===id&&x.business===business);if(!selected)return;
    let next=parkedSales.filter(x=>x.id!==id);
    if(cart.length)next.push({id:uid(),business,cart,customerId,quoteId,requestId:requestId.current,created:new Date().toISOString()});
    setParkedSales(next);setCart(selected.cart);setCustomerId(selected.customerId||"");setQuoteId(selected.quoteId||null);requestId.current=selected.requestId||uid();setView("pos");setFocusKey(x=>x+1);toast("Venta en espera recuperada");
  }
  function toast(text) {
    setMessage(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMessage(""), 6500);
  }
  async function refresh(b = business, a = start, z = end) {
    const [s, h] = await Promise.all([
      api(b, "/api/state"),
      api(b, `/api/history?start=${a}&end=${z}`),
    ]);
    setState(s);
    setHistory(h);
    return s;
  }
  async function navigate(id) {
    setView(id);
    if (id !== "pos") return;
    setFocusKey((value) => value + 1);
    setSwitching(true);
    try {
      await refresh();
      toast("Punto de venta actualizado con las existencias más recientes");
    } catch (error) {
      toast(error.message);
    } finally {
      setSwitching(false);
    }
  }
  useEffect(() => {
    (async () => {
      try {
        const status = await api(business, "/api/status");
        if (status.setup) {
          setSetup(true);
          return;
        }
        try {
          await refresh();
          setSetup(null);
        } catch (e) {
          if (e.status === 400) {
            const other = business === 1 ? 2 : 1;
            try {
              await refresh(other);
              setBusiness(other);
              return;
            } catch {}
          }
          if (e.status === 401 || e.status === 400) setSetup(status.setup);
          else throw e;
        }
      } catch (e) {
        setFailure(e.message);
      }
    })();
    return () => clearTimeout(toastTimer.current);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.business =
      business === 1 ? "market" : "hardware";
  }, [business]);
  useEffect(() => {
    const queueChanged = () => setPending(pendingSales().length);
    const connected = async () => {
      setOnline(true);
      const result = await syncPendingSales();
      queueChanged();
      if (result.synced) {
        toast(`${result.synced} operación(es) pendientes sincronizadas`);
        try { await refresh(); } catch {}
      }
    };
    const disconnected = () => setOnline(false);
    addEventListener("online", connected);
    addEventListener("offline", disconnected);
    addEventListener("pos-queue-change", queueChanged);
    if (navigator.onLine && pendingSales().length) connected();
    return () => {
      removeEventListener("online", connected);
      removeEventListener("offline", disconnected);
      removeEventListener("pos-queue-change", queueChanged);
    };
  }, [business]);
  useEffect(() => {
    function key(e) {
      if (!state || modal) return;
      if(e.key==="F1"){e.preventDefault();newSale();return;}
      if(e.key==="F5"){e.preventDefault();setView("guarantors");return;}
      if (e.key === "F2") {
        e.preventDefault();
        setView("pos");
        setFocusKey((x) => x + 1);
      }
      if (e.code === "Space" && (view === "pos" || view === "vegetables")) {
        const t = e.target,
          field = ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(
            t.tagName,
          );
        if (!field || (t.id === "search" && !t.value)) {
          e.preventDefault();
          action("checkout");
        }
      }
    }
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [state, modal, view, cart,customerId,quoteId,parkedSales,business]);
  async function login(d, first) {
    if (first) await api(business, "/api/setup", d);
    await api(business, "/api/login", d);
    let b = business;
    try {
      await refresh(b);
    } catch (e) {
      if (e.status !== 400) throw e;
      b = b === 1 ? 2 : 1;
      await refresh(b);
    }
    setBusiness(b);
    sessionStorage.setItem("business", String(b));
    setSetup(null);
  }
  const command = (action, data) =>
    api(business, "/api/command", { action, data });
  function close() {
    setModal(null);
    setFocusKey((x) => x + 1);
  }
  function showReceipt(kind, id, message = "", auto = false) {
    setModal({ type: "receipt", kind, id, message, auto, key: uid() });
  }
  function form(type, id, extra = {}) {
    setModal({ type, id, ...extra, key: uid() });
  }
  async function switchBusiness(b) {
    if (b === business || switchLock.current) return;
    if (cart.length) {
      toast(
        "Finaliza, guarda como cotización o vacía la venta actual antes de cambiar de negocio",
      );
      return;
    }
    switchLock.current = true;
    setSwitching(true);
    try {
      await refresh(b);
      setBusiness(b);
      sessionStorage.setItem("business", String(b));
      setCustomerId("");
      setQuoteId(null);
      setView("pos");
      setModal(null);
    } catch (e) {
      toast(e.message);
    } finally {
      switchLock.current = false;
      setSwitching(false);
    }
  }
  function addProduct(id, index, after, options = {}) {
    const dairyId=String(id).startsWith("dairy-")?Number(String(id).slice(6)):null;
    const source=dairyId?state.dairy_products.find(x=>x.id===dairyId):null;
    const p=source?{...source,id:`dairy-${source.id}`,dairy:true,dairy_product_id:source.id,sku:source.code,description:"Recaudo por cuenta de terceros",price_basis:1000,available:Infinity}:state.products.find((x) => x.id === id);
    if (!p) return;
    if (p.price <= 0) {
      toast(p.dairy?"Un usuario autorizado debe configurar el precio en Control de lácteos":"Asigna un precio a este producto en Inventario antes de venderlo");
      return;
    }
    if (index == null && !productNeedsWeight(p)) {
      const amount = automaticProductQuantity(p);
      setCart((current) => {
        const next = current.map((x) => ({ ...x }));
        const line = next.find((x) => x.id === p.id);
        if (line) line.qty += amount;
        else next.push({ ...p, qty: amount });
        return next;
      });
      requestId.current = uid();
      after?.();
      return;
    }    form("quantity", id, {
      product: p,
      index,
      after,
      initial:
        index == null
          ? p.unit === "g"
            ? ""
            : 1
          : qty(cart[index].qty, p.unit),
    });
  }
  async function saveForm(d) {
    const { type, id } = modal;
    if (type === "quantity") {
      const p = modal.product,
        raw = Number(d.qty) * (["m","litro","libra"].includes(p.unit) ? 1000 : 1),
        q = Math.round(raw);
      if (q <= 0 || Math.abs(raw - q) > 0.000001)
        throw Error("Cantidad inválida");
      setCart((current) => {
        const next = current.map((x) => ({ ...x }));
        if (modal.index != null) next[modal.index].qty = q;
        else {
          const l = next.find((l) => l.id === p.id);
          if (l) l.qty += q;
          else next.push({ ...p, qty: q });
        }
        return next;
      });
      requestId.current = uid();
      modal.after?.();
      close();
      return;
    }
    if (type === "clear_cart") {
      setCart([]);
      setQuoteId(null);
      requestId.current = uid();
      close();
      return;
    }
    if (type === "unregistered_product") {
      const q=Number(d.qty), price=Math.round(Number(d.price)*100), total=q*price;
      if(!Number.isInteger(q)||q<1||price<1) throw Error("Revise la cantidad y el precio");
      setCart(c=>[...c,{id:`extra-${uid()}`,unregistered:true,name:"Producto no registrado",qty:q,unit:"und",price,originalPrice:price,discount:0,total,price_basis:1,description:"No afecta inventario"}]);
      requestId.current=uid(); close(); return;
    }
    let payload = { ...d };
    if (type === "product") payload = { ...d, id, perishable: !!d.perishable };
    if (type === "customer") payload = { ...d, id };
    if (type === "waste") payload.lot_id = id;
    if (type === "repay" || type === "email" || type === "void_sale")
      payload.sale_id = id;
    if (type === "quote_email") payload.quote_id = id;
    if (type === "void_purchase") payload.purchase_id = id;
    if (type === "purchase_return") payload.purchase_line_id = id;
    if (type === "sale_return") payload.sale_id = id;
    if (["repay", "purchase_return", "manual_purchase_return", "sale_return"].includes(type))
      payload.request_id = uid();
    if (type === "quote")
      payload = {
        ...d,
        customer_id: Number(customerId) || null,
        lines: cart.filter(l=>!l.unregistered).map((l) => ({ product_id: l.id, qty: qty(l.qty, l.unit) })),
        unregistered_lines: cart.filter(l=>l.unregistered).map(unregisteredLinePayload),
      };
    if (type === "user") {
      payload.businesses = d.access === "both" ? [1, 2] : [Number(d.access)];
      payload.id = id || null;
      payload.active = id ? Boolean(d.active) : true;
    }
    const result = await command(type, payload);
    if (type === "change_password") {
      setState(null);
      setSetup(false);
      close();
      toast("PIN actualizado. Inicia sesión nuevamente.");
      return;
    }
    if (type === "quote") {
      setCart([]);
      setQuoteId(null);
      setCustomerId("");
      requestId.current = uid();
    }
    try {
      await refresh();
    } catch (e) {
      toast(
        "La operación se guardó, pero no se pudo actualizar la pantalla. Recarga antes de continuar.",
      );
    }
    if (result.receipt)
      showReceipt(
        type === "open_cash" ? "cash_open" : result.receipt,
        result.id,
        "Operación guardada",
        type !== "quote",
      );
    else {
      close();
      toast(
        result.offline && type === "open_cash"
          ? "Caja abierta sin internet. Ya puedes facturar; se sincronizará al recuperar la conexión."
          : type === "email"
          ? "Recibo agregado a la cola de correo"
          : "Datos guardados",
      );
    }
  }
  async function saveSale(payload) {
    const shouldPrint = payload._print_receipt !== false;
    delete payload._print_receipt;
    const saleCart = cart.map((item) => ({ ...item }));
    payload._offline = {
      total: cartTotal(saleCart),
      operator: state.user.name,
      customer: state.customers.find((customer) => customer.id === Number(payload.customer_id))?.name || null,
    };
    // Solo la escritura de la venta bloquea el diálogo. Impresión y refresco continúan en segundo plano.
    const r = await command("sale", payload);
    setCart([]);
    setQuoteId(null);
    setCustomerId("");
    requestId.current = uid();
    close();
    refresh().catch(() => {
      if (!r.offline) toast("Venta guardada. Recarga para actualizar inventario.");
    });
    if (!shouldPrint) {
      toast((r.offline ? "Venta local pendiente de sincronizar" : "Venta guardada correctamente") + " sin imprimir recibo." + (r.change ? " Cambio: " + cop(r.change) : ""));
      return;
    }
    const printing = r.offline
      ? printOfflineSale({
          businessName: business === 1 ? "MINI MARKET" : "FERRETERIA",
          requestId: payload.request_id,
          cart: saleCart,
          payments: payload.payments,
          total: cartTotal(saleCart),
          cashReceived: payload.cash_received,
          change: payload.change_given,
        })
      : printReceipt(business, "sale", r.id);
    printing.then(() => toast(
      (r.offline ? "Venta local guardada e impresa. Se sincronizará automáticamente." : "Venta guardada e impresa.") +
      (r.change ? " Cambio: " + cop(r.change) : ""),
    )).catch((error) => toast(
      (r.offline ? "Venta local guardada" : "Venta guardada") +
      ". No se imprimió: " + error.message + ". Puedes reimprimirla desde Ventas.",
    ));
  }
  async function dates(a, z) {
    try {
      await refresh(business, a, z);
      setStart(a);
      setEnd(z);
    } catch (e) {
      toast(e.message);
    }
  }
  async function action(a, id) {
    try {
      switch (a) {
        case "price_required":
          toast("El administrador debe asignar el precio en Inventario");
          break;
        case "dairy_price":
          if (state.dairy_access?.can_price) setView("dairy");
          else toast("No tiene permiso para configurar precios de lácteos");
          break;
        case "photo_credits":
          form("photo_credits");
          break;
        case "new_product":
          form("product");
          break;
        case "unregistered_product":
          form("unregistered_product");
          break;
        case "edit_product":
          form("product", id);
          break;
        case "receive":
          form(state.products.length ? "receive" : "product");
          break;
        case "initial_stock":
          form(state.products.length ? "initial_stock" : "product");
          break;
        case "new_customer":
          form("customer");
          break;
        case "edit_customer":
          form("customer", id);
          break;
        case "business_settings":
          form("settings");
          break;
        case "new_user":
          form("user");
          break;
        case "edit_user":
          form("user", id);
          break;
        case "password":
          form("change_password");
          break;
        case "checkout":
          if (!cart.length) return;
          form(state.cash ? "checkout" : "open_cash");
          break;
        case "save_quote":
          if (!cart.length) {
            toast("Agrega productos antes de guardar la cotización");
            return;
          }
          form("quote", null, { total: cartTotal(cart) });
          break;
        case "new_quote":
          setView("pos");
          break;
        case "clear_cart":
          if (cart.length) form("clear_cart");
          break;
        case "convert_quote": {
          if (cart.length) {
            toast(
              "Guarda o vacía la venta actual antes de cargar la cotización",
            );
            return;
          }
          const q = await api(business, "/api/quote?id=" + id);
          const lines = q.lines.map((l) => {
            if(l.unregistered) return {id:`extra-${uid()}`,unregistered:true,name:"Producto no registrado",qty:l.qty,unit:"und",price:l.price,originalPrice:l.price,discount:0,total:l.total,price_basis:1,description:"No afecta inventario"};
            const p = state.products.find((p) => p.id === l.product_id);
            if (!p)
              throw Error("La cotización contiene un producto no disponible");
            return { ...p, qty: l.qty };
          });
          setCart(lines);
          setQuoteId(id);
          setCustomerId(q.customer_id || "");
          requestId.current = uid();
          setView("pos");
          toast(
            "Cotización cargada con precios actuales. Revisa el total antes de cobrar.",
          );
          break;
        }
        case "send_emails": {
          toast("Procesando cola de correo…");
          const r = await api(business, "/api/send-emails", {});
          await refresh();
          toast(`${r.sent} de ${r.attempted} recibos enviados`);
          break;
        }
        case "quote_whatsapp": {
          const q = history.quotes.find((x) => x.id === id);
          const phone = String(q?.customer_phone || "").replace(/\D/g, "");
          if (!phone)
            throw Error("El cliente de la cotización no tiene teléfono registrado");
          window.open(
            `/quote.pdf?business=${business}&id=${id}`,
            "_blank",
            "noopener",
          );
          window.open(
            `https://wa.me/${phone}?text=${encodeURIComponent(
              "Hola, adjuntamos la cotización solicitada. Quedamos atentos a cualquier inquietud. El PDF se descargó en tu computador para que puedas adjuntarlo en este chat.",
            )}`,
            "_blank",
            "noopener",
          );
          toast(
            "Se descargó la cotización y se abrió WhatsApp Web. Adjunta el PDF en el chat.",
          );
          break;
        }
        case "invoice_sale":
          if (business !== 2) throw Error("La factura tamaño carta está disponible únicamente en ferretería");
          form("invoice", id);
          break;
        case "invoice_download": {
          if (business !== 2) throw Error("La factura tamaño carta está disponible únicamente en ferretería");
          const sale = history.sales.find((item) => item.id === id);
          if (!sale) throw Error("No se encontró la venta seleccionada");
          await downloadInvoicePdf(id, sale.number);
          toast("Factura PDF descargada correctamente");
          break;
        }
        case "invoice_whatsapp": {
          if (business !== 2) throw Error("La factura tamaño carta está disponible únicamente en ferretería");
          const sale = history.sales.find((item) => item.id === id);
          if (!sale) throw Error("No se encontró la venta seleccionada");
          const rawPhone = String(sale.customer_phone || "").replace(/\D/g, "");
          const phone = rawPhone.length === 10 && rawPhone.startsWith("3") ? `57${rawPhone}` : rawPhone;
          await downloadInvoicePdf(id, sale.number);
          const businessName = state.businesses.find((item) => item.id === 2)?.name || "nuestra ferretería";
          const message = `Hola${sale.customer ? ` ${sale.customer}` : ""}, adjuntamos la factura ${saleNumber(sale, 2)} de ${businessName} por ${cop(sale.total)}. Gracias por su compra.`;
          const whatsappUrl = phone
            ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
            : `https://web.whatsapp.com/send?text=${encodeURIComponent(message)}`;
          window.open(whatsappUrl, "_blank", "noopener");
          toast("Se descargó la factura y se abrió WhatsApp Web. Adjunta el PDF descargado en el chat.");
          break;
        }
        case "create_dispatch":
          setDispatchSaleId(id);
          setView("dispatches");
          break;
        case "logout":
          if (cart.length) {
            toast("Termina o vacía la venta actual antes de cerrar sesión");
            return;
          }
          await api(business, "/api/logout", {});
          setState(null);
          setSetup(false);
          break;
        default:
          if (a === "reprint_sale") {
            await printReceipt(business, "sale", id);
            toast("Recibo enviado a la impresora");
          } else if (a === "sale_return") {
            const sale = await api(business, `/api/sale-return-options?id=${id}`);
            form(a, id, { sale });
          } else if (a.startsWith("receipt_")) showReceipt(a.slice(8), id);
          else form(a, id);
      }
    } catch (e) {
      toast(e.message);
    }
  }
  if (failure)
    return (
      <div className="empty">
        <strong>No se pudo abrir el portal</strong>
        {failure}
        <p>
          <Button onClick={() => location.reload()}>Reintentar</Button>
        </p>
      </div>
    );
  if (!state)
    return setup === null ? (
      <div className="loading">Conectando con tu negocio…</div>
    ) : (
      <Auth setup={setup} onLogin={login} />
    );
  const common = {
    state,
    history,
    business,
    admin,
    onAction: action,
    start,
    end,
    onDates: dates,
  };
  const pages = {
    inventory: Inventory,
    customers: Customers,
    guarantors: Guarantors,
    cash: Cash,
    sales: Sales,
    quotes: Quotes,
    reports: Reports,
    settings: Settings,
    accounting: Accounting,
    dairy: Dairy,
    dispatches: Dispatches,
    labels: Labels,
  };
  const Page = pages[view];
  return (
    <>
      <div className="shell">
        <aside className="sidebar">
          <Brand />
          <div className="business-label">
            {business === 1 ? "MINI MARKET" : "FERRETERÍA"}
          </div>
          <div className="nav-label">OPERACIÓN DIARIA</div>
          <nav className="nav">
            {navigation
              .filter(
                (x) =>
                  (x[0] !== "quotes" || business === 2) &&
                  (x[0] !== "vegetables" || business === 1) &&
                  (x[0] !== "dairy" || (business === 1 && state.dairy_access?.can_view)) &&
                  (x[0] !== "accounting" || state.finance_access?.can_view) &&
                  (!["reports", "settings"].includes(x[0]) || admin),
              )
              .map(([id, icon, label]) => (
                <button
                  key={id}
                  className={view === id ? "active" : ""}
                  onClick={() => navigate(id)}
                >
                  <span className="nav-icon">{icon}</span>
                  {label}
                </button>
              ))}
          </nav>
          <div className="side-bottom">
            <b>{state.user.name}</b>
            <br />
            <small>{admin ? "Administrador" : "Cajero"}</small>
            <br />
            <Button onClick={() => action("password")}>
              Cambiar PIN
            </Button>
            <Button onClick={() => action("logout")}>Cerrar sesión</Button>
          </div>
        </aside>
        <main>
          <header className="topbar">
            <div className="business-switch" aria-label="Cambiar negocio">
              {state.businesses.map((b) => (
                <button
                  key={b.id}
                  disabled={switching}
                  className={business === b.id ? "selected" : ""}
                  onClick={() => switchBusiness(b.id)}
                >
                  {b.name}
                </button>
              ))}
            </div>
            <button
              className={`status sync-status ${!online || pending ? "local-mode" : ""}`}
              title="Sincronizar operaciones pendientes"
              onClick={async () => {
                if (!navigator.onLine) return toast("Sin conexión. Las operaciones siguen guardadas en este equipo.");
                const result = await syncPendingSales();
                setPending(result.pending);
                if (result.synced) await refresh();
                toast(result.pending ? `${result.pending} operación(es) aún pendientes` : "Sincronización al día");
              }}
            >
              {online ? "En línea" : "Sin internet"}{pending ? ` · ${pending} pendiente(s)` : " · sincronizado"}
            </button>
            <Badge tone={state.cash?.offline || !state.cash ? "warn" : ""}>
              {state.cash ? (state.cash.offline ? "Caja local · pendiente" : "Caja abierta #" + state.cash.id) : "Caja cerrada"}
            </Badge>
          </header>
          <div className="workspace">
            {switching ? (
              <div className="loading">Cambiando de negocio…</div>
            ) : view === "pos" || view === "vegetables" ? (
              <PointOfSale
                key={`${business}-${view}`}
                vegetables={view === "vegetables"}
                {...common}
                cart={cart}
                quoteId={quoteId}
                customerId={customerId}
                setCustomerId={setCustomerId}
                focusKey={focusKey}
                parkedSales={parkedSales.filter(x=>x.business===business)}
                onNewSale={newSale}
                onResumeSale={resumeSale}
                onProduct={addProduct}
                onRemove={(i) => {
                  setCart((c) => c.filter((_, j) => i !== j));
                  requestId.current = uid();
                }}
              />
            ) : (
              <Page {...common} initialSaleId={view === "dispatches" ? dispatchSaleId : null} onInitialSaleHandled={() => setDispatchSaleId(null)} onBack={() => setView("pos")} />
            )}
          </div>
        </main>
      </div>
      {modal?.type === "checkout" ? (
        <Checkout
          key={modal.key}
          total={cartTotal(cart)}
          business={business}
          cart={cart}
          customers={state.customers}
          customerId={customerId}
          requestId={requestId.current}
          quoteId={quoteId}
          onClose={close}
          onSave={saveSale}
        />
      ) : modal?.type === "receipt" ? (
        <Receipt
          key={modal.key}
          {...modal}
          business={business}
          onClose={close}
          onEmail={(id) => form("email", id)}
        />
      ) : modal?.type === "invoice" ? (
        <LetterInvoice
          key={modal.key}
          id={modal.id}
          onClose={close}
          onWhatsApp={(id) => action("invoice_whatsapp", id)}
        />
      ) : (
        modal && (
          <OperationForm
            key={modal.key}
            config={modal}
            {...common}
            onClose={close}
            onSubmit={saveForm}
          />
        )
      )}
      {message && (
        <div className="react-toast" role="status" aria-live="polite">
          {message}
        </div>
      )}
    </>
  );
}
