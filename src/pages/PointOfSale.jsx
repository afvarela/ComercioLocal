import React, { useEffect, useMemo, useRef, useState } from "react";
import { Head, Button } from "../components/UI.jsx";
import {
  cop,
  stockLabel,
  base,
  lineTotal,
  cartTotal,
} from "../lib/format.js";
import { filterCustomers } from "../lib/customers.js";
import { matchesProductSearch } from "../lib/productSearch.js";
import { useProductSearch } from "../lib/useProductSearch.js";
export default function PointOfSale({
  business,
  state,
  cart,
  quoteId,
  customerId,
  setCustomerId,
  onAction,
  onProduct,
  onRemove,
  focusKey,
  parkedSales,
  onNewSale,
  onResumeSale,
  vegetables = false,
}) {
  const [search, setSearch] = useState(""),
    [category, setCategory] = useState(vegetables ? "Verduras" : ""),
    [highlight, setHighlight] = useState(0),
    [cartHighlight, setCartHighlight] = useState(-1),
    [customerPicker, setCustomerPicker] = useState(false),
    [customerSearch, setCustomerSearch] = useState(""),
    [marketView, setMarketView] = useState(() => localStorage.getItem("comercio-pos-market-view") === "rows" ? "rows" : "cards");
  const input = useRef(null);
  const cartRefs = useRef([]);
  useEffect(() => {
    input.current?.focus();
  }, [focusKey]);
  useEffect(() => {
    function captureScanner(event) {
      const tag = event.target?.tagName;
      if (document.querySelector("dialog[open]") || ["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;
      if (event.key.length === 1 && /^[a-zA-Z0-9_-]$/.test(event.key)) {
        event.preventDefault();
        setSearch((value) => value + event.key);
        input.current?.focus();
      }
    }
    document.addEventListener("keydown", captureScanner);
    return () => document.removeEventListener("keydown", captureScanner);
  }, []);
  useEffect(() => {
    function shortcuts(event) {
      if (event.key === "F8" && cart.length) {
        event.preventDefault();
        const index = cartHighlight >= 0 ? cartHighlight : cart.length - 1;
        onProduct(cart[index].id, index, undefined, { product: cart[index] });
      }
    }
    document.addEventListener("keydown", shortcuts);
    return () => document.removeEventListener("keydown", shortcuts);
  }, [cart, cartHighlight, onProduct]);
  useEffect(() => {
    cartRefs.current[cartHighlight]?.scrollIntoView({ block: "nearest" });
  }, [cartHighlight]);
  const productSearch = useProductSearch(business, state.products, search, 90);
  const results = useMemo(() => {
    const searching = Boolean(search.trim());
    return (searching ? productSearch.products : state.products).filter(
      (p) =>
        (searching || !category || p.category === category) &&
        matchesProductSearch(p, search),
    );
  }, [state.products, productSearch.products, search, category]);
  const dairyResults = useMemo(
    () =>
      vegetables
        ? []
        : (state.dairy_products || []).filter((product) =>
            matchesProductSearch(
              {
                ...product,
                sku: "LÁCTEO-" + product.id,
                category: "Lácteos caseros",
                description: "Dinero de terceros",
              },
              search,
            ),
          ),
    [state.dairy_products, search, vegetables],
  );
  const categories = [
    ...new Set(state.products.map((p) => p.category).filter(Boolean)),
  ];
  const customerResults = filterCustomers(state.customers, customerSearch);
  function add(id, index, scanned = false, product = null) {
    onProduct(id, index, () => {
      setSearch("");
      setHighlight(0);
      input.current?.focus();
    }, { scanned, product });
  }
  async function key(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      let exact = state.products.find(
        (p) => p.barcode === search.trim() || p.sku === search.trim(),
      );
      if (!exact && /^[0-9]{6,}$/.test(search.trim())) {
        try { exact = await productSearch.exact(search.trim()); } catch {}
      }
      const p = exact || results[highlight];
      if (p) add(p.id, undefined, Boolean(exact?.barcode && exact.barcode === search.trim()), p);
    } else if (["ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      if (!search && cart.length) {
        setCartHighlight((current) => Math.max(0, Math.min(cart.length - 1, (current < 0 ? cart.length : current) + (e.key === "ArrowDown" ? 1 : -1))));
        return;
      }
      setHighlight((h) =>
        Math.max(
          0,
          Math.min(results.length - 1, h + (e.key === "ArrowDown" ? 1 : -1)),
        ),
      );
    }
  }
  function chooseProduct(product) {
    if (product.price) add(product.id, undefined, false, product);
    else onAction(state.user.role === "admin" ? "edit_product" : "price_required", product.id);
  }
  function changeMarketView(view) {
    setMarketView(view);
    localStorage.setItem("comercio-pos-market-view", view);
    setHighlight(0);
    input.current?.focus();
  }
  if (business === 2 && !vegetables) {
    return (
      <>
        <Head title="Punto de venta · Ferretería" subtitle="Busca referencias y agrega productos en una lista de venta.">
          <Button primary onClick={onNewSale}>Nueva venta <span className="key">F1</span></Button>
          {!state.cash && <Button primary onClick={() => onAction("open_cash")}>Abrir caja</Button>}
          <Button onClick={() => onAction("save_quote")}>Guardar cotización</Button>
          <Button onClick={() => onAction("unregistered_product")}>Producto no registrado</Button>
        </Head>
        {!!parkedSales.length && <div className="parked-sales"><b>Ventas en espera</b>{parkedSales.map((sale, i) => <button key={sale.id} onClick={() => onResumeSale(sale.id)}>Venta {i + 1}<small>{sale.cart.length} producto(s) · {cop(cartTotal(sale.cart))}</small></button>)}</div>}
        <div className="hardware-pos-layout">
          <section className="panel hardware-sale-workspace">
            <div className="hardware-search-area">
              <label htmlFor="hardware-search">Buscar producto</label>
              <div className="searchbox">
                <span className="search-icon">⌕</span>
                <input id="hardware-search" ref={input} value={search} onChange={(event) => { setSearch(event.target.value); if (event.target.value.trim()) setCategory(""); setHighlight(0); }} onKeyDown={key} placeholder="Escribe nombre, referencia o descripción…" autoComplete="off" />
              </div>
              <div className="search-hint"><span><kbd className="key">Enter</kbd> Agregar · <kbd className="key">↑ ↓</kbd> Seleccionar</span><span>{results.length} resultado(s)</span></div>
            </div>
            <div className="hardware-section-heading"><div><h2>Resultados de búsqueda</h2><small>Haz clic en una fila para agregar el producto.</small></div></div>
            <div className="hardware-table-scroll hardware-results-scroll">
              <table className="hardware-table hardware-products-table">
                <thead><tr><th>Referencia</th><th>Producto</th><th>Descripción</th><th>Disponible</th><th className="number">Precio</th><th></th></tr></thead>
                <tbody>
                  {results.slice(0, 40).map((product, index) => <tr key={product.id} className={index === highlight ? "highlight" : ""} onClick={() => chooseProduct(product)}>
                    <td><b>{product.sku}</b></td>
                    <td>{product.name}</td>
                    <td className="description-cell">{product.description || product.category || "—"}</td>
                    <td>{stockLabel(product.available, product.unit)}</td>
                    <td className="number"><b>{product.price ? cop(product.price) : "Sin precio"}</b><small>/{base(product.unit, product.price_basis)}</small></td>
                    <td><button type="button" className="table-add" aria-label={`Agregar ${product.name}`}>{product.price ? "Agregar" : "Precio"}</button></td>
                  </tr>)}
                  {!results.length && <tr><td colSpan="6" className="hardware-empty">No encontramos productos con esa búsqueda.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="hardware-section-heading current-sale-heading"><div><h2>{quoteId ? `Productos de la cotización #${quoteId}` : "Productos agregados"}</h2><small>La venta se actualiza al agregar, cambiar cantidades o retirar filas.</small></div><button type="button" className="inline-link" onClick={() => onAction("clear_cart")}>Vaciar lista</button></div>
            <div className="hardware-table-scroll hardware-cart-scroll">
              <table className="hardware-table hardware-cart-table">
                <thead><tr><th>#</th><th>Referencia</th><th>Producto</th><th className="number">Cantidad</th><th>Unidad</th><th className="number">Valor unitario</th><th className="number">Subtotal</th><th></th></tr></thead>
                <tbody>
                  {cart.map((line, index) => <tr ref={(node) => { cartRefs.current[index] = node; }} key={`${line.id}-${index}`} className={index === cartHighlight ? "selected" : ""} onClick={() => setCartHighlight(index)}>
                    <td>{index + 1}</td>
                    <td>{line.sku || (line.unregistered ? "NO REGISTRADO" : "—")}</td>
                    <td><b>{line.name}</b></td>
                    <td className="number"><button type="button" className="quantity-cell" disabled={line.unregistered} onClick={() => !line.unregistered && add(line.id, index, false, line)}>{stockLabel(line.qty, line.unit)} ✎</button></td>
                    <td>{base(line.unit, line.price_basis)}</td>
                    <td className="number">{cop(line.price)}</td>
                    <td className="number subtotal-cell">{cop(lineTotal(line))}</td>
                    <td><button type="button" className="remove-row" aria-label={`Quitar ${line.name}`} onClick={() => onRemove(index)}>×</button></td>
                  </tr>)}
                  {!cart.length && <tr><td colSpan="8" className="hardware-empty">Busca un producto arriba y agrégalo; las filas de la venta aparecerán aquí.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
          <aside className="panel hardware-sale-total">
            <div><small>Venta actual</small><h2>{quoteId ? `Cotización #${quoteId}` : "Resumen"}</h2></div>
            <div className="ticket-client">
              <label>Cliente para venta o fiado</label>
              <button type="button" className="customer-picker-button" onClick={() => { setCustomerSearch(""); setCustomerPicker(true); }}>{state.customers.find((customer) => customer.id === Number(customerId))?.name || "Consumidor final · buscar cliente"}</button>
            </div>
            <div className="hardware-total-details"><div><span>Productos agregados</span><b>{cart.length}</b></div><div><span>Estado de caja</span><b>{state.cash ? "Abierta" : "Sin abrir"}</b></div></div>
            <div className="hardware-grand-total"><span>Total de la venta</span><strong>{cop(cartTotal(cart))}</strong></div>
            <button className="primary checkout" disabled={!cart.length} onClick={() => onAction("checkout")}><span>Cobrar venta</span><kbd className="key">Espacio</kbd></button>
            <p className="print-note no-margin">El total cambia automáticamente con cada fila.</p>
          </aside>
        </div>
        {customerPicker && <div className="customer-picker-backdrop" role="dialog" aria-modal="true" aria-label="Seleccionar cliente para fiado"><div className="customer-picker-dialog"><div className="dialog-header"><h2>Seleccionar cliente</h2><button type="button" className="close" onClick={() => setCustomerPicker(false)}>×</button></div><label htmlFor="pos-customer-search">Buscar por nombre o cédula</label><input id="pos-customer-search" autoFocus value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Nombre o número de documento" autoComplete="off" /><div className="customer-picker-results"><button type="button" className={!customerId ? "selected" : ""} onClick={() => { setCustomerId(""); setCustomerPicker(false); }}>Consumidor final</button>{customerResults.map((customer) => <button type="button" key={customer.id} className={Number(customerId) === customer.id ? "selected" : ""} onClick={() => { setCustomerId(String(customer.id)); setCustomerPicker(false); }}><b>{customer.name}</b><small>CC {customer.document || "Sin documento"} · saldo {cop(customer.balance)}</small></button>)}</div><Button onClick={() => onAction("new_customer")}>+ Crear cliente nuevo</Button></div></div>}
        <div className="shortcut-bar"><span><kbd className="key">F1</kbd> Guardar e iniciar otra venta</span><span><kbd className="key">F2</kbd> Buscar producto</span><span><kbd className="key">F8</kbd> Cambiar cantidad</span><span><kbd className="key">Espacio</kbd> Cobrar</span></div>
      </>
    );
  }
  return (
    <>
      <Head
        title={vegetables ? "Verduras por peso" : "Punto de venta"}
        subtitle={
          vegetables
            ? "Precio por libra de 500 g. Ingresa los gramos y calculamos el total."
            : business === 1
              ? "Escanea, busca y agrega. Así de simple."
              : "Encuentra cada referencia y vende sin complicaciones."
        }
      >
        <Button primary onClick={onNewSale}>Nueva venta <span className="key">F1</span></Button>
        {!state.cash && (
          <Button primary onClick={() => onAction("open_cash")}>
            Abrir caja
          </Button>
        )}
        {business === 2 && (
          <Button onClick={() => onAction("save_quote")}>
            Guardar cotización
          </Button>
        )}
        <Button onClick={() => onAction("unregistered_product")}>Producto no registrado</Button>
      </Head>
      {!!parkedSales.length&&<div className="parked-sales"><b>Ventas en espera</b>{parkedSales.map((sale,i)=><button key={sale.id} onClick={()=>onResumeSale(sale.id)}>Venta {i+1}<small>{sale.cart.length} producto(s) · {cop(cartTotal(sale.cart))}</small></button>)}</div>}
      <div className="pos-grid">
        <section>
          <div className="searchbox">
            <span className="search-icon">⌕</span>
            <input
              id="search"
              ref={input}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (e.target.value.trim()) setCategory("");
                setHighlight(0);
              }}
              onKeyDown={key}
              placeholder={
                business === 1
                  ? "Busca un producto o escanea su código…"
                  : "Busca por nombre, referencia o descripción…"
              }
              autoComplete="off"
              aria-label="Buscar productos"
            />
          </div>
          <div className="search-hint">
            <span>
              <kbd className="key">Enter</kbd> Seleccionar ·{" "}
              <kbd className="key">↑ ↓</kbd> Mover selección · Usa fragmentos como <kbd className="key">SHA* ORI*</kbd>
            </span>
            <span>{search.trim() ? results.length + dairyResults.length : state.products.length + dairyResults.length} producto(s)</span>
          </div>
          <div className="category-row">
            {business === 1 && (
              <button
                className={`chip vegetable-chip ${category === "Verduras" ? "selected" : ""}`}
                onClick={() => {
                  setCategory("Verduras");
                  setHighlight(0);
                }}
              >
                Verduras · por libra
              </button>
            )}
            <button
              className={`chip ${!category ? "selected" : ""}`}
              onClick={() => {
                setCategory("");
                setHighlight(0);
              }}
            >
              Todos
            </button>
            {categories
              .filter((c) => c !== "Verduras")
              .map((c) => (
                <button
                  key={c}
                  className={`chip ${category === c ? "selected" : ""}`}
                  onClick={() => {
                    setCategory(c);
                    setHighlight(0);
                  }}
                >
                  {c}
                </button>
              ))}
          </div>
          <div className="market-view-switch" role="group" aria-label="Forma de mostrar productos">
            <span>Mostrar productos como</span>
            <button type="button" className={marketView === "cards" ? "selected" : ""} onClick={() => changeMarketView("cards")}>▦ Tarjetas</button>
            <button type="button" className={marketView === "rows" ? "selected" : ""} onClick={() => changeMarketView("rows")}>☷ Filas</button>
          </div>
          {marketView === "rows" ? (
            <div className="market-row-results hardware-table-scroll">
              <table className="hardware-table market-products-table">
                <thead><tr><th></th><th>Producto</th><th>Referencia</th><th>Categoría</th><th>Disponible</th><th className="number">Precio</th><th></th></tr></thead>
                <tbody>
                  {dairyResults.map((product) => <tr key={`dairy-${product.id}`} className="dairy-row" onClick={() => product.price ? add(`dairy-${product.id}`) : onAction("dairy_price", product.id)}>
                    <td><span className="market-row-icon">L</span></td><td><b>{product.name}</b><small>Dinero de terceros</small></td><td>LÁCTEO-{product.id}</td><td>Lácteos caseros</td><td>Sin inventario</td><td className="number"><b>{product.price ? cop(product.price) : "Sin precio"}</b><small>/{product.unit}</small></td><td><button type="button" className="table-add">{product.price ? "Agregar" : "Precio"}</button></td>
                  </tr>)}
                  {results.slice(0, 90).map((product, index) => <tr key={product.id} className={index === highlight ? "highlight" : ""} onClick={() => chooseProduct(product)}>
                    <td>{product.image ? <img className="market-row-photo" src={product.image} alt="" loading="lazy" /> : <span className="market-row-icon">{product.name.slice(0, 1).toUpperCase()}</span>}</td>
                    <td><b>{product.name}</b><small>{product.description || "Sin descripción"}</small></td>
                    <td>{product.sku}</td><td>{product.category || "Sin categoría"}</td><td className={product.available <= product.min_stock ? "warn-text" : ""}>{stockLabel(product.available, product.unit)}</td><td className="number"><b>{product.price ? cop(product.price) : "Sin precio"}</b><small>/{base(product.unit, product.price_basis)}</small></td><td><button type="button" className="table-add">{product.price ? "Agregar" : "Precio"}</button></td>
                  </tr>)}
                  {!results.length && !dairyResults.length && <tr><td colSpan="7" className="hardware-empty">No encontramos productos con esa búsqueda.</td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
          <div className="products">
            {business===1&&!vegetables&&dairyResults.map((p)=><button key={`dairy-${p.id}`} className="product-card dairy-card" onClick={()=>p.price?add(`dairy-${p.id}`):onAction("dairy_price",p.id)}><span className="category">LÁCTEOS CASEROS</span><span className="name">{p.name}</span><span className="description">Sin inventario · dinero de terceros</span><span className="price">{p.price?cop(p.price):"Configurar precio"}<small> / {p.unit}</small></span><span className="plus">+</span></button>)}
            {results.length ? (
              results.slice(0, 90).map((p, i) => (
                <button
                  key={p.id}
                  className={`product-card ${p.image ? "has-image" : ""} tone-${i % 4} ${i === highlight ? "highlight" : ""}`}
                  onClick={() =>
                    p.price
                      ? add(p.id, undefined, false, p)
                      : onAction(
                          state.user.role === "admin"
                            ? "edit_product"
                            : "price_required",
                          p.id,
                        )
                  }
                >
                  {p.image && (
                    <img
                      className="product-photo"
                      src={p.image}
                      alt={p.name}
                      loading="lazy"
                    />
                  )}
                  <span className="category">{p.category || p.sku}</span>
                  <span className="name">{p.name}</span>
                  <span className="description">{p.description || p.sku}</span>
                  <span className="price">
                    {p.price ? cop(p.price) : "Asignar precio"}
                    <small> / {base(p.unit, p.price_basis)}</small>
                  </span>
                  <span
                    className={`stock ${p.available <= p.min_stock ? "warn-text" : ""}`}
                  >
                    {stockLabel(p.available, p.unit)} disponibles
                  </span>
                  <span className="plus">+</span>
                </button>
              ))
            ) : !dairyResults.length && (
              <div className="panel empty" style={{ gridColumn: "1/-1" }}>
                <div className="empty-icon">▦</div>
                <strong>
                  {state.products.length
                    ? "No encontramos ese producto"
                    : "Tu catálogo comienza aquí"}
                </strong>
                {state.products.length
                  ? "Prueba otro nombre, referencia o código."
                  : "Registra tus productos y recibe el inventario para empezar a vender."}
                {state.user.role === "admin" && (
                  <p>
                    <Button primary onClick={() => onAction("new_product")}>
                      Crear producto
                    </Button>
                  </p>
                )}
              </div>
            )}
          </div>
          )}
        </section>
        <aside className="panel ticket">
          <div className="ticket-header">
            <h2>{quoteId ? "Desde cotización #" + quoteId : "Venta actual"}</h2>
            <button
              className="inline-link"
              onClick={() => onAction("clear_cart")}
            >
              Vaciar
            </button>
          </div>
          <div className="ticket-client">
            <label>Cliente para venta o fiado</label>
            <button type="button" className="customer-picker-button" onClick={() => { setCustomerSearch(""); setCustomerPicker(true); }}>
              {state.customers.find((customer) => customer.id === Number(customerId))?.name || "Consumidor final · buscar cliente"}
            </button>
          </div>
          <div className="cart-lines">
            {cart.length ? (
              cart.map((l, i) => (
                <div ref={(node) => { cartRefs.current[i] = node; }} className={`cart-line ${i === cartHighlight ? "selected" : ""}`} key={l.id} onClick={() => setCartHighlight(i)}>
                  <div className="cart-line-head">
                    <span>{l.name}</span>
                    <span>{cop(lineTotal(l))}</span>
                  </div>
                  <div className="cart-line-foot">
                    <button disabled={l.unregistered} onClick={() => !l.unregistered&&add(l.id, i, false, l)}>
                      {stockLabel(l.qty, l.unit)} ✎
                    </button>
                    <span>
                      {cop(l.price)}/{base(l.unit, l.price_basis)}
                    </span>
                    <button
                      aria-label={"Quitar " + l.name}
                      onClick={() => onRemove(i)}
                    >
                      ×
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty">
                <div className="empty-icon">▤</div>
                <strong>Lista para tu próxima venta</strong>Los productos que
                agregues
                <br />
                aparecerán aquí.
              </div>
            )}
          </div>
          <div className="ticket-summary">
            <div className="row">
              <span>Productos en la venta</span>
              <span>{cart.length}</span>
            </div>
            <div className="total">
              <span>Total</span>
              <span>{cop(cartTotal(cart))}</span>
            </div>
            <button
              className="primary checkout"
              disabled={!cart.length}
              onClick={() => onAction("checkout")}
            >
              <span>Cobrar venta</span>
              <kbd className="key">Espacio</kbd>
            </button>
            <p className="print-note no-margin" style={{ marginTop: 12 }}>
              Recibo interno · se genera al confirmar el cobro
            </p>
          </div>
        </aside>
      </div>
      {customerPicker && <div className="customer-picker-backdrop" role="dialog" aria-modal="true" aria-label="Seleccionar cliente para fiado">
        <div className="customer-picker-dialog">
          <div className="dialog-header"><h2>Seleccionar cliente</h2><button type="button" className="close" onClick={() => setCustomerPicker(false)}>×</button></div>
          <label htmlFor="pos-customer-search">Buscar por nombre o cédula</label>
          <input id="pos-customer-search" autoFocus value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} placeholder="Nombre o número de documento" autoComplete="off" />
          <div className="customer-picker-results">
            <button type="button" className={!customerId ? "selected" : ""} onClick={() => { setCustomerId(""); setCustomerPicker(false); }}>Consumidor final</button>
            {customerResults.map((customer) => <button type="button" key={customer.id} className={Number(customerId) === customer.id ? "selected" : ""} onClick={() => { setCustomerId(String(customer.id)); setCustomerPicker(false); }}><b>{customer.name}</b><small>CC {customer.document || "Sin documento"} · saldo {cop(customer.balance)}</small></button>)}
          </div>
          <Button onClick={() => onAction("new_customer")}>+ Crear cliente nuevo</Button>
        </div>
      </div>}
      {vegetables && (
        <p className="photo-credit">
          Fotos ilustrativas de Wikimedia Commons. Algunas variedades pueden
          diferir.{" "}
          <button
            className="inline-link"
            onClick={() => onAction("photo_credits")}
          >
            Ver créditos
          </button>
        </p>
      )}
      <div className="shortcut-bar">
        <span><kbd className="key">F1</kbd> Guardar venta actual e iniciar otra</span>
        <span>
          <kbd className="key">F2</kbd> Buscar producto
        </span>
        <span><kbd className="key">F5</kbd> Consultar clientes fiadores</span>
        <span>
          <kbd className="key">Enter</kbd> Confirmar selección / cantidad
        </span>
        <span>
          <kbd className="key">Espacio</kbd> Cobrar desde el buscador vacío
        </span>
        <span>
          <kbd className="key">Esc</kbd> Cerrar ventana
        </span>
      </div>
    </>
  );
}
