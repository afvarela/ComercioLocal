import React, { useEffect, useState } from "react";
import {
  Head,
  Button,
  Panel,
  Table,
  Metrics,
  Badge,
  Notice,
  DateRange,
  Field,
} from "../components/UI.jsx";
import { matchesProductSearch } from "../lib/productSearch.js";
import {
  cop,
  dt,
  localDate,
  stockLabel,
  base,
  saleNumber,
  normalize,
  gainMargin,
  methods,
} from "../lib/format.js";
import {
  listPrinters,
  savePrinter,
  saveDispatchPrinter,
  selectedPrinter,
  selectedDispatchPrinter,
  testPrinter,
  testDispatchPrinter,
} from "../lib/printer.js";
import { api } from "../lib/api.js";
import { rankCustomers } from "../lib/customers.js";
function PrinterSettings() {
  const [printers, setPrinters] = useState([]),
    [selected, setSelected] = useState(selectedPrinter()),
    [dispatchSelected, setDispatchSelected] = useState(selectedDispatchPrinter()),
    [message, setMessage] = useState("");
  async function load() {
    try {
      const r = await listPrinters();
      setPrinters(r.printers);
      const saved = selectedPrinter();
      const automatic = r.printers.find((name) => /(^|\b)(80mm|58mm|pos|receipt|thermal)(\b|$)/i.test(name));
      if ((!saved || !r.printers.includes(saved)) && automatic) {
        savePrinter(automatic);
        setSelected(automatic);
        setMessage(`Agente conectado. Impresora POS seleccionada: ${automatic}`);
      } else {
        setMessage(saved && !r.printers.includes(saved) ? "La impresora guardada ya no está disponible. Selecciona una de la lista." : "Agente conectado");
      }
      const savedDispatch = selectedDispatchPrinter();
      if ((!savedDispatch || !r.printers.includes(savedDispatch)) && automatic) {
        saveDispatchPrinter(automatic);
        setDispatchSelected(automatic);
      }
    } catch (e) {
      setMessage("Inicia INICIAR-IMPRESORA.cmd en este computador. " + e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  return (
    <Panel padded>
      <h2>Impresora de recibos</h2>
      <p className="muted">Configuración guardada únicamente en este equipo.</p>
      <select
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value);
          savePrinter(e.target.value);
        }}
      >
        <option value="">Seleccionar impresora</option>
        {printers.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      <div className="actions" style={{ marginTop: 14 }}>
        <Button onClick={load}>Actualizar lista</Button>
        <Button
          onClick={async () => {
            try {
              await testPrinter(selected);
              setMessage("Prueba enviada correctamente");
            } catch (e) {
              setMessage(e.message);
            }
          }}
          disabled={!selected}
        >
          Imprimir prueba
        </Button>
      </div>
      <p className="print-note">{message}</p>
      <hr style={{ margin: "22px 0", border: 0, borderTop: "1px solid var(--line)" }}/>
      <h2>Impresora de despachos</h2>
      <p className="muted">Se usará automáticamente para imprimir los comprobantes de despacho.</p>
      <select
        aria-label="Impresora predeterminada para despachos"
        value={dispatchSelected}
        onChange={(e) => {
          setDispatchSelected(e.target.value);
          saveDispatchPrinter(e.target.value);
        }}
      >
        <option value="">Usar impresora de recibos</option>
        {printers.map((p) => (
          <option key={p}>{p}</option>
        ))}
      </select>
      <div className="actions" style={{ marginTop: 14 }}>
        <Button
          onClick={async () => {
            try {
              await testDispatchPrinter(dispatchSelected || selected);
              setMessage("Prueba de despacho enviada correctamente");
            } catch (e) {
              setMessage(e.message);
            }
          }}
          disabled={!dispatchSelected && !selected}
        >
          Probar impresora de despachos
        </Button>
      </div>
    </Panel>
  );
}
export function Inventory({
  state,
  history,
  business,
  admin,
  onAction,
  start,
  end,
  onDates,
}) {
  const [tab, setTab] = useState("products"),
    [search, setSearch] = useState(""), [categoryFilter,setCategoryFilter]=useState(""), [statusFilter,setStatusFilter]=useState("active");
  const inventoryProducts = [...state.products, ...(state.inactive_products || [])];
  const near = state.lots.filter(
      (l) => l.expires && l.expires <= localDate(30),
    ),
    low = state.products.filter((p) => p.available <= p.min_stock);
  const products = inventoryProducts.filter(
    (p) =>
      (statusFilter === "all" || (statusFilter === "active" ? !!p.active : !p.active)) &&
      (!categoryFilter || p.category === categoryFilter) &&
      matchesProductSearch(p, search),
  );
  return (
    <>
      <Head
        title="Inventario"
        subtitle="Productos, lotes y cada movimiento de existencias."
      >
        {admin && (
          <>
            <a className="export-button" href={`/api/inventory.xlsx?business=${business}&category=${encodeURIComponent(categoryFilter)}&search=${encodeURIComponent(search)}`}>Descargar Inventario Disponible (.xlsx)</a>
            <Button primary onClick={() => onAction("new_product")}>
              + Nuevo producto
            </Button>
            <Button onClick={() => onAction("receive")}>
              Recibir mercancía
            </Button>
            {business === 1 && (
              <Button accent onClick={() => onAction("initial_stock")}>
                + Existencia inicial rápida
              </Button>
            )}
            <Button onClick={() => onAction("manual_purchase_return")}>
              Devolución manual a proveedor
            </Button>
          </>
        )}
      </Head>
      <Metrics
        items={[
          {
            label: "Referencias activas",
            value: state.products.length,
            note: "Catálogo de este negocio",
          },
          {
            label: "Existencias bajas",
            value: low.length,
            note: "Igual o debajo del mínimo",
          },
          {
            label: "Vencen en 30 días",
            value: near.filter((l) => l.expires >= localDate()).length,
            note: "Lotes con saldo",
          },
          {
            label: "Lotes vencidos",
            value: near.filter((l) => l.expires < localDate()).length,
            note: "Bloqueados para venta",
          },
        ]}
      />
      <div className="page-head">
        <div className="tabs">
          {[
            ["products", "Productos"],
            ["lots", business === 1 ? "Existencias por lote" : "Lotes y vencimientos"],
            ["moves", "Movimientos"],
            ["purchases", "Compras y devoluciones"],
          ]
            .filter((x) => !["moves", "purchases"].includes(x[0]) || admin)
            .map(([id, label]) => (
              <button
                className={tab === id ? "active" : ""}
                onClick={() => setTab(id)}
                key={id}
              >
                {label}
              </button>
            ))}
        </div>
        {tab === "moves" || tab === "purchases" ? (
          <DateRange start={start} end={end} onApply={onDates} />
        ) : (
          <div className="inventory-filters"><select aria-label="Filtrar estado" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="active">Activos</option><option value="inactive">Desactivados</option><option value="all">Todos</option></select><select aria-label="Filtrar categoría" value={categoryFilter} onChange={e=>setCategoryFilter(e.target.value)}><option value="">Todas las categorías</option>{[...new Set(inventoryProducts.map(p=>p.category).filter(Boolean))].map(x=><option key={x}>{x}</option>)}</select><input
            className="inventory-search"
            aria-label="Buscar en inventario"
            placeholder="Buscar producto o referencia"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (e.target.value.trim()) setCategoryFilter("");
            }}
          /></div>
        )}
      </div>
      <Panel>
        {tab === "purchases" ? (
          <>
            <Table
              headers={["Compra", "Proveedor", "Fecha", "Total", "Estado", "Acción"]}
              rows={(history.purchases || []).map((p) => [
                `COMP-${String(p.number).padStart(6, "0")}`,
                p.supplier,
                dt(p.created),
                cop(p.total),
                <Badge tone={p.status === "Anulada" ? "red" : ""}>{p.status}</Badge>,
                p.status === "Activa" ? <Button className="danger" onClick={() => onAction("void_purchase", p.id)}>Anular compra</Button> : "—",
              ])}
            />
            <div className="section-title"><h2>Productos comprados</h2></div>
            <Table
              headers={["Documento", "Producto", "Comprado", "Devuelto", "Costo", "Acción"]}
              rows={(history.purchase_lines || []).map((l) => [
                `COMP-${String(l.purchase_number).padStart(6, "0")}`,
                l.name,
                stockLabel(l.qty, l.unit),
                stockLabel(l.returned_qty, l.unit),
                cop(l.cost) + " / " + base(l.unit, l.cost_basis),
                l.purchase_status !== "Anulada" && l.returned_qty < l.qty ? <Button onClick={() => onAction("purchase_return", l.id)}>Devolver al proveedor</Button> : "—",
              ])}
            />
            <div className="section-title"><h2>Documentos de devolución</h2></div>
            <Table
              headers={["Documento", "Compra original", "Proveedor", "Fecha", "Total", "Motivo"]}
              rows={(history.purchase_returns || []).map((r) => [
                `DCP-${String(r.number).padStart(6, "0")}`,
                r.purchase_id ? `Compra #${r.purchase_id}` : "Devolución manual",
                r.supplier,
                dt(r.created),
                cop(r.total),
                r.reason,
              ])}
            />
          </>
        ) : tab === "lots" ? (
          <>
          {business === 1 && <Notice info>Cada fila corresponde a un lote distinto. “INICIAL” agrupa las unidades que ya tenías cuando comenzaste; las entradas nuevas conservan su lote, vencimiento y cantidad por separado.</Notice>}
          <Table
            headers={[
              "Producto / lote",
              "Vencimiento",
              "Disponible",
              "Proveedor",
              ...(admin ? ["Costo / base", "Acción"] : []),
            ]}
            rows={state.lots
              .filter((l) =>
                normalize(l.name + " " + l.code).includes(normalize(search)),
              )
              .map((l) => [
                <>
                  {l.name}
                  <small>{l.code}</small>
                </>,
                l.expires ? (
                  <Badge
                    tone={
                      l.expires < localDate()
                        ? "red"
                        : l.expires <= localDate(30)
                          ? "warn"
                          : ""
                    }
                  >
                    {l.expires}
                  </Badge>
                ) : (
                  "Sin vencimiento"
                ),
                stockLabel(l.qty, l.unit),
                l.supplier,
                ...(admin
                  ? [
                      cop(l.cost) + " / " + base(l.unit, l.cost_basis),
                      <Button onClick={() => onAction("waste", l.id)}>
                        Registrar merma
                      </Button>,
                    ]
                  : []),
              ])}
          />
          </>
        ) : tab === "moves" ? (
          <Table
            headers={[
              "Fecha",
              "Producto / lote",
              "Movimiento",
              "Entrada",
              "Salida",
              "Existencia",
              "Costo unitario",
              "Costo total",
              "Documento / usuario",
              "Observación",
            ]}
            rows={(history.stock_moves || []).map((m) => [
              dt(m.created),
              <>
                {m.name}
                <small>{m.code}</small>
              </>,
              m.kind,
              m.qty > 0 ? stockLabel(m.qty, m.unit) : "—",
              m.qty < 0 ? stockLabel(-m.qty, m.unit) : "—",
              stockLabel(m.balance_after, m.unit),
              cop(m.cost) + " / " + base(m.unit, m.cost_basis),
              cop(
                Math.round(
                  (Math.abs(m.qty) * m.cost) /
                    (m.unit === "g"
                      ? m.cost_basis || 1000
                      : m.unit === "m"
                        ? 1000
                        : 1),
                ),
              ),
              <>{m.reference}<small>{m.operator}</small></>,
              m.note || "—",
            ])}
          />
        ) : (
          <Table
            headers={[
              "Producto / referencia",
              "Unidad de precio",
              "Precio",
              "Costo promedio",
              "Margen de ganancia",
              "Disponible",
              "Mínimo",
              "Estado",
              ...(admin ? ["Acción"] : []),
            ]}
            rows={products.map((p) => [
              <>
                {p.name}
                <small>
                  {p.sku}
                  {p.barcode ? " · " + p.barcode : ""}
                </small>
              </>,
              base(p.unit, p.price_basis),
              cop(p.price),
              cop(p.current_cost) + " / " + base(p.unit, p.price_basis),
              `${gainMargin(p.price, p.current_cost).toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`,
              <span className={p.available <= p.min_stock ? "warn-text" : ""}>
                {stockLabel(p.available, p.unit)}
              </span>,
              stockLabel(p.min_stock, p.unit),
              <Badge tone={p.active ? "" : "red"}>{p.active ? "Activo" : "Desactivado"}</Badge>,
              ...(admin
                ? [
                    <Button onClick={() => onAction("edit_product", p.id)}>
                      {p.active ? "Editar / desactivar" : "Editar / reactivar"}
                    </Button>,
                  ]
                : []),
            ])}
          />
        )}
      </Panel>
    </>
  );
}
export function Customers({ state, history, business, admin, onAction }) {
  return (
    <>
      <Head
        title="Clientes y fiados"
        subtitle="Saldos, vencimientos y abonos sin perder el detalle."
      >
        <Button primary onClick={() => onAction("new_customer")}>
          + Nuevo cliente
        </Button>
      </Head>
      <Metrics
        items={[
          {
            label: "Total por cobrar",
            value: cop(history.debts.reduce((s, d) => s + d.debt, 0)),
            note: "Saldo vigente de este negocio",
          },
          {
            label: "Cartera vencida",
            value: cop(
              history.debts
                .filter((d) => d.due < localDate())
                .reduce((s, d) => s + d.debt, 0),
            ),
            note: "Según la fecha acordada",
          },
          { label: "Ventas con saldo", value: history.debts.length },
          { label: "Clientes registrados", value: state.customers.length },
        ]}
      />
      <div className="stack">
        <Panel title="Cuentas por cobrar">
          <Table
            headers={["Cliente", "Venta", "Vence", "Saldo", "Acción"]}
            rows={history.debts.map((d) => [
              <>
                {d.customer}
                <small>{d.phone}</small>
              </>,
              saleNumber(d, business),
              <Badge tone={d.due < localDate() ? "red" : "warn"}>
                {d.due}
              </Badge>,
              cop(d.debt),
              <Button onClick={() => onAction("repay", d.id)}>
                Registrar abono
              </Button>,
            ])}
          />
        </Panel>
        <Panel title="Directorio de clientes">
          <Table
            headers={[
              "Nombre / documento",
              "Contacto",
              "Cupo de crédito",
              "Saldo",
              "Acción",
            ]}
            rows={state.customers.map((c) => [
              <>
                {c.name}
                <small>{c.document}</small>
              </>,
              <>
                {c.phone}
                <small>{c.email}</small>
              </>,
              c.credit_limit ? cop(c.credit_limit) : <Badge>Sin límite</Badge>,
              cop(c.balance),
              admin ? (
                <div className="actions"><Button onClick={() => onAction("edit_customer", c.id)}>Editar</Button>{c.balance>0&&<Button primary onClick={()=>onAction("customer_payment",c.id)}>Pagar saldo</Button>}</div>
              ) : (
                "—"
              ),
            ])}
          />
        </Panel>
        <Panel title="Historial de cartera">
          <Table
            headers={[
              "Fecha",
              "Cliente",
              "Movimiento",
              "Valor",
              "Saldo después",
              "Detalle",
            ]}
            rows={(history.receivable_moves || []).map((m) => [
              dt(m.created),
              m.customer,
              m.kind,
              cop(m.amount),
              cop(m.balance_after),
              m.note || "—",
            ])}
          />
        </Panel>
      </div>
    </>
  );
}

export function Guarantors({ state, onBack }) {
  const [search, setSearch] = useState("");
  const customers = rankCustomers(state.customers, search);
  return <>
    <Head title="Clientes fiadores" subtitle="Consulta por nombre o cédula. Primero aparecen quienes más compran.">
      <Button onClick={onBack}>Volver al punto de venta</Button>
    </Head>
    <div className="guarantor-search"><Field name="guarantor_search" label="Buscar fiador" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre o número de cédula" autoFocus /></div>
    <Panel title="Clientes ordenados por compras">
      <Table headers={["Cliente / cédula", "Total comprado", "Compras", "Saldo fiado", "Cupo disponible"]} rows={customers.map((customer) => [
        <><b>{customer.name}</b><small>CC {customer.document || "Sin documento"}</small></>,
        cop(customer.total_purchases || 0),
        customer.purchase_count || 0,
        <Badge tone={customer.balance > 0 ? "warn" : ""}>{cop(customer.balance)}</Badge>,
        customer.credit_limit ? cop(Math.max(0, customer.credit_limit - customer.balance)) : "Sin límite definido",
      ])} />
    </Panel>
  </>;
}
export function Cash({ state, history, business, admin, onAction }) {
  const c = state.cash;
  return (
    <>
      <Head
        title="Caja y arqueo"
        subtitle="Cada peso registrado desde la apertura hasta el cierre."
      >
        {c ? (
          <>
            <Button onClick={() => onAction("cash_move")}>
              Registrar entrada / retiro
            </Button>
            <Button primary onClick={() => onAction("close_cash")}>
              Cerrar y arquear caja
            </Button>
          </>
        ) : (
          <Button primary onClick={() => onAction("open_cash")}>
            Abrir caja
          </Button>
        )}
      </Head>
      {c ? (
        <Metrics
          items={[
            {
              label: "Efectivo esperado",
              value: cop(c.expected),
              note: "Base + efectivo recibido + movimientos",
            },
            {
              label: "Base de apertura",
              value: cop(c.opening),
              note: "Recibo de apertura guardado",
            },
            { label: "Abierta por", value: c.operator, note: dt(c.opened) },
            {
              label: "Sesión de caja",
              value: "#" + c.id,
              note: business === 1 ? "Mini market" : "Ferretería",
            },
          ]}
        />
      ) : (
        <Notice info>
          No hay caja abierta. Registra el dinero base antes de cobrar ventas o
          recibir abonos.
        </Notice>
      )}
      <Panel title="Aperturas y cierres">
        <Table
          headers={[
            "Caja",
            "Apertura",
            "Base",
            "Cierre",
            "Contado / diferencia",
            "Recibo",
          ]}
          rows={history.cash_sessions.map((c) => [
            c.offline ? `LOCAL-${String(c.id).slice(-6).toUpperCase()}` : "#" + c.id,
            dt(c.opened),
            cop(c.opening),
            c.closed ? dt(c.closed) : <Badge tone={c.offline ? "warn" : ""}>{c.offline ? "LOCAL · pendiente" : "Abierta"}</Badge>,
            c.closed ? (
              <>
                {cop(c.counted)}
                <small>Diferencia {cop(c.counted - c.expected)}</small>
              </>
            ) : (
              "—"
            ),
            <div className="actions">
              {!c.offline && <Button onClick={() => onAction("receipt_cash_open", c.id)}>
                Apertura
              </Button>}
              {c.closed && (
                <Button onClick={() => onAction("receipt_cash", c.id)}>
                  Cierre
                </Button>
              )}
            </div>,
          ])}
        />
      </Panel>
      {admin && (
        <Panel className="subsection" title="Entradas y retiros del período">
          <Table
            headers={["Fecha", "Caja", "Motivo", "Valor"]}
            rows={(history.cash_moves || []).map((m) => [
              dt(m.created),
              "#" + m.cash_id,
              m.reason,
              cop(m.amount),
            ])}
          />
        </Panel>
      )}
    </>
  );
}
export function Sales({
  state,
  history,
  business,
  admin,
  onAction,
  start,
  end,
  onDates,
}) {
  const [customerFilter, setCustomerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");
  const needle = normalize(customerFilter);
  const sales = (history.sales || []).filter((sale) => {
    const customerMatches = !needle || normalize(`${sale.customer || ""} ${sale.customer_document || ""}`).includes(needle);
    const statusMatches = !statusFilter || (statusFilter === "local" ? sale.offline : sale.status === statusFilter);
    const methodMatches = !methodFilter || normalize(sale.payment_methods || (sale.debt ? "Fiado" : "")).includes(normalize(methodFilter));
    return customerMatches && statusMatches && methodMatches;
  });
  return (
    <>
      <Head
        title="Ventas y recibos"
        subtitle="Consulta, reimprime y comparte los comprobantes."
      >
        <DateRange start={start} end={end} onApply={onDates} />
      </Head>
      <div className="report-filter-bar">
        <Field name="sales_customer_filter" label="Cliente o documento" value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} placeholder="Buscar por nombre o cédula" />
        <label className="field">Estado<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">Todos</option><option value="active">Registradas</option><option value="void">Anuladas</option><option value="local">Locales pendientes</option></select></label>
        <label className="field">Medio de pago<select value={methodFilter} onChange={(event) => setMethodFilter(event.target.value)}><option value="">Todos</option>{methods.map((method)=><option key={method}>{method}</option>)}<option>Fiado</option></select></label>
      </div>
      <Panel>
        <Table
          headers={[
            "Recibo / fecha",
            "Cliente",
            "Total",
            "Medio de pago",
            "Saldo fiado",
            "Estado",
            "Acciones",
          ]}
          rows={sales.map((s) => [
            <>
              {s.offline ? `LOCAL-${String(s.request_id).slice(-6).toUpperCase()}` : saleNumber(s, business)}
              <small>
                {dt(s.created)} · {s.operator}
              </small>
            </>,
            s.customer || "Consumidor final",
            cop(s.total),
            <>{s.payment_methods || (s.debt ? "Fiado" : "-")}{!!s.cash_received && <small>Recibido: {cop(s.cash_received)} / cambio: {cop(s.change_given)}</small>}</>,
            cop(s.debt),
            <Badge tone={s.offline ? "warn" : s.status === "void" ? "red" : ""}>
              {s.offline ? "LOCAL · pendiente" : s.status === "void" ? "Anulada" : "Registrada"}
            </Badge>,
            <div className="actions">
              {!s.offline && <Button onClick={() => onAction("receipt_sale", s.id)}>
                Ver recibo
              </Button>}
              {!s.offline && <Button onClick={() => onAction("reprint_sale", s.id)}>
                Reimprimir recibo
              </Button>}
              {!s.offline && business === 2 && <Button primary onClick={() => onAction("invoice_sale", s.id)}>
                Factura carta
              </Button>}
              {!s.offline && business === 2 && <Button className="invoice-download" onClick={() => onAction("invoice_download", s.id)}>
                Descargar PDF
              </Button>}
              {!s.offline && business === 2 && <Button onClick={() => onAction("invoice_whatsapp", s.id)}>
                WhatsApp
              </Button>}
              {!s.offline && s.status === "active" && <Button onClick={() => onAction("create_dispatch", s.id)}>Crear despacho</Button>}
              {!s.offline && <Button onClick={() => onAction("email", s.id)}>Correo</Button>}
              {admin &&
                s.status === "active" &&
                state.cash?.id === s.cash_id && (
                  <>
                    <Button onClick={() => onAction("sale_return", s.id)}>
                      Registrar devolución
                    </Button>
                    <Button
                      className="danger"
                      onClick={() => onAction("void_sale", s.id)}
                    >
                      Anular
                    </Button>
                  </>
                )}
            </div>,
          ])}
        />
      </Panel>
      <Panel
        className="subsection"
        title="Envíos por correo"
        action={
          <Button onClick={() => onAction("send_emails")}>
            Enviar pendientes
          </Button>
        }
      >
        {!state.smtp_configured && (
          <div style={{ margin: 20 }}>
            <Notice>
              Correo pendiente de configurar. Los recibos permanecen en cola
              hasta que configures SMTP y pulses Enviar pendientes.
            </Notice>
          </div>
        )}
        <Table
          headers={["Fecha", "Destinatario", "Estado", "Detalle"]}
          rows={history.emails.map((e) => [
            dt(e.created),
            e.recipient,
            { pending: "Pendiente", sent: "Enviado", error: "Reintentar" }[
              e.status
            ] || e.status,
            e.error,
          ])}
        />
      </Panel>
    </>
  );
}
export function Quotes({ history, onAction }) {
  return (
    <>
      <Head
        title="Cotizaciones"
        subtitle="Prepara la propuesta y conviértela en venta."
      >
        <Button primary onClick={() => onAction("new_quote")}>
          Nueva cotización
        </Button>
      </Head>
      <Notice info>
        Arma los productos en el punto de venta y pulsa Guardar cotización. No
        se descuenta inventario hasta confirmar la venta. Al convertir se
        revisan precios y existencias actuales.
      </Notice>
      <Panel>
        <Table
          headers={[
            "Cotización / fecha",
            "Cliente",
            "Vigencia",
            "Total",
            "Estado",
            "Acciones",
          ]}
          rows={history.quotes.map((q) => [
            <>
              COT-{String(q.id).padStart(6, "0")}
              <small>{dt(q.created)}</small>
            </>,
            q.customer || "Consumidor final",
            q.valid_until,
            cop(q.total),
            q.converted_sale ? (
              <Badge>Convertida</Badge>
            ) : q.valid_until < localDate() ? (
              <Badge tone="red">Vencida</Badge>
            ) : (
              <Badge tone="blue">Pendiente</Badge>
            ),
            <div className="actions">
              <Button onClick={() => onAction("receipt_quote", q.id)}>
                Ver
              </Button>
              <a href={`/quote.pdf?business=2&id=${q.id}`}>Descargar PDF</a>
              <Button onClick={() => onAction("quote_email", q.id)}>
                Enviar por correo
              </Button>
              <Button onClick={() => onAction("quote_whatsapp", q.id)}>
                WhatsApp
              </Button>
              {!q.converted_sale && q.valid_until >= localDate() && (
                <Button onClick={() => onAction("convert_quote", q.id)}>
                  Convertir a venta
                </Button>
              )}
            </div>,
          ])}
        />
      </Panel>
    </>
  );
}
function Bars({ data, label, value }) {
  const max = Math.max(1, ...data.map((x) => x[value] || 0));
  return <div className="report-bars">{data.map((x, i) => <div className="bar-row" key={i}><span>{x[label]}</span><div className="bar"><i style={{width:`${Math.max(2,(x[value]||0)*100/max)}%`}} /></div><b>{cop(x[value]||0)}</b></div>)}</div>;
}
function SalesChart({ data }) {
  const max=Math.max(1,...data.map(x=>x.sales));
  const points=data.map((x,i)=>`${data.length===1?50:i*100/(data.length-1)},${92-x.sales*82/max}`).join(" ");
  return <div className="chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none"><polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" vectorEffect="non-scaling-stroke" /></svg><div className="chart-labels"><span>{data[0]?.day||"Sin ventas"}</span><span>{data.at(-1)?.day||""}</span></div></div>;
}
export function Reports({ history, business, start, end, onDates }) {
  const [report,setReport]=useState(null), [tab,setTab]=useState("resumen"), [error,setError]=useState("");
  const [clientFilter,setClientFilter]=useState(""),[productFilter,setProductFilter]=useState(""),[categoryFilter,setCategoryFilter]=useState(""),[paymentFilter,setPaymentFilter]=useState("");
  useEffect(()=>{let active=true;setReport(null);setError("");api(business,`/api/analytics?start=${start}&end=${end}`).then(x=>active&&setReport(x)).catch(e=>active&&setError(e.message));return()=>{active=false}},[business,start,end,history.sales.length]);
  const quick=(days)=>{const z=new Date(),a=new Date();a.setDate(z.getDate()-days+1);onDates(a.toISOString().slice(0,10),z.toISOString().slice(0,10))};
  const yesterday=()=>{const d=new Date();d.setDate(d.getDate()-1);const x=d.toISOString().slice(0,10);onDates(x,x)}, month=()=>{const d=new Date(),a=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;onDates(a,localDate())}, year=()=>onDates(`${new Date().getFullYear()}-01-01`,localDate());
  if(error) return <><Head title="Centro de reportes" subtitle="No fue posible cargar los indicadores."/><Notice>Abre la versión actualizada en <b>http://127.0.0.1:8766/</b>. Detalle: {error}</Notice><Button onClick={()=>location.reload()}>Reintentar</Button></>;
  if(!report) return <div className="loading">Preparando indicadores…</div>;
  const clientNeedle=normalize(clientFilter),productNeedle=normalize(productFilter),allLines=history.sale_lines||[],allPayments=history.sale_payments||[];
  const productSaleIds=new Set(allLines.filter(line=>(!productNeedle||normalize(line.name).includes(productNeedle))&&(!categoryFilter||line.category===categoryFilter)).map(line=>Number(line.sale_id)));
  const paymentSaleIds=new Set(allPayments.filter(payment=>!paymentFilter||payment.method===paymentFilter).map(payment=>Number(payment.sale_id)));
  const filteredSales=(history.sales||[]).filter(sale=>(!clientNeedle||normalize(`${sale.customer||""} ${sale.customer_document||""}`).includes(clientNeedle))&&(!productNeedle&&!categoryFilter||productSaleIds.has(Number(sale.id)))&&(!paymentFilter||paymentSaleIds.has(Number(sale.id))));
  const selectedIds=new Set(filteredSales.map(sale=>Number(sale.id))),filteredLines=allLines.filter(line=>selectedIds.has(Number(line.sale_id))&&(!productNeedle||normalize(line.name).includes(productNeedle))&&(!categoryFilter||line.category===categoryFilter));
  const activeSales=filteredSales.filter(sale=>sale.status==="active"&&!sale.offline),hasFilters=Boolean(clientNeedle||productNeedle||categoryFilter||paymentFilter);
  const summary=hasFilters?{...report.summary,transactions:activeSales.length,sales:activeSales.reduce((n,sale)=>n+Number(sale.total||0),0),cost:activeSales.reduce((n,sale)=>n+Number(sale.cost||0),0)}:report.summary;
  if(hasFilters){summary.margin=summary.sales-summary.cost;summary.average_ticket=summary.transactions?Math.round(summary.sales/summary.transactions):0;}
  const daily=hasFilters?[...activeSales.reduce((map,sale)=>{const day=String(sale.created).slice(0,10),item=map.get(day)||{day,transactions:0,sales:0,margin:0};item.transactions++;item.sales+=Number(sale.total||0);item.margin+=Number(sale.total||0)-Number(sale.cost||0);map.set(day,item);return map;},new Map()).values()].sort((a,b)=>a.day.localeCompare(b.day)):report.daily;
  const categories=hasFilters?[...filteredLines.reduce((map,line)=>{const category=line.category||"Sin categoría",item=map.get(category)||{category,sales:0,margin:0};item.sales+=Number(line.total||0);item.margin+=Number(line.total||0)-Number(line.cost||0);map.set(category,item);return map;},new Map()).values()].sort((a,b)=>b.sales-a.sales):report.categories;
  const payments=hasFilters?[...allPayments.filter(payment=>selectedIds.has(Number(payment.sale_id))&&(!paymentFilter||payment.method===paymentFilter)).reduce((map,payment)=>map.set(payment.method,(map.get(payment.method)||0)+Number(payment.amount||0)),new Map()).entries()].map(([method,amount])=>({method,amount})):report.payments;
  const sellers=hasFilters?[...activeSales.reduce((map,sale)=>{const seller=sale.operator||"Sin usuario",item=map.get(seller)||{seller,transactions:0,sales:0,margin:0};item.transactions++;item.sales+=Number(sale.total||0);item.margin+=Number(sale.total||0)-Number(sale.cost||0);map.set(seller,item);return map;},new Map()).values()]:report.sellers;
  const rotation=report.rotation.filter(product=>(!productNeedle||normalize(product.name).includes(productNeedle))&&(!categoryFilter||product.category===categoryFilter));
  const s=summary;
  return (
    <>
      <Head
        title="Tablero ejecutivo"
        subtitle="Indicadores de ventas, rentabilidad, caja, cartera e inventario."
      >
        <a className="export-button" href={tab==="productos"||tab==="inventario"?`/api/inventory.xlsx?business=${business}`:`/api/report.xlsx?business=${business}&start=${start}&end=${end}&kind=${tab==="resumen"?"ventas":tab}`}>Descargar Excel</a>
        <DateRange start={start} end={end} onApply={onDates} />
      </Head>
      <div className="quick-filters"><Button onClick={()=>quick(1)}>Hoy</Button><Button onClick={yesterday}>Ayer</Button><Button onClick={()=>quick(7)}>Semana</Button><Button onClick={month}>Mes</Button><Button onClick={year}>Año</Button><Button onClick={()=>quick(90)}>90 días</Button></div>
      <div className="report-filter-bar"><Field name="report_client" label="Cliente / documento" value={clientFilter} onChange={event=>setClientFilter(event.target.value)} /><Field name="report_product" label="Producto" value={productFilter} onChange={event=>setProductFilter(event.target.value)} /><label className="field">Categoría<select value={categoryFilter} onChange={event=>setCategoryFilter(event.target.value)}><option value="">Todas</option>{[...new Set((history.sale_lines||[]).map(line=>line.category).filter(Boolean))].sort().map(category=><option key={category}>{category}</option>)}</select></label><label className="field">Medio de pago<select value={paymentFilter} onChange={event=>setPaymentFilter(event.target.value)}><option value="">Todos</option>{methods.map(method=><option key={method}>{method}</option>)}</select></label></div>
      <Metrics
        items={[
          {label:"Ventas netas",value:cop(s.sales),note:`${s.transactions} transacciones`},
          {label:"Margen bruto",value:cop(s.margin),note:s.sales?`${Math.round(s.margin*100/s.sales)}% de las ventas`:"Sin ventas"},
          {label:"Venta promedio",value:cop(s.average_ticket),note:"Por comprobante"},
          {label:"Cartera por cobrar",value:cop(s.receivables),note:"Saldo actual"},
        ]}
      />
      <div className="tabs report-tabs">{[["resumen","Resumen ejecutivo"],["ventas","Ventas"],["recaudos","Recaudos"],["cartera","Cartera"],["kardex","Kardex"],["productos","Productos"],["inventario","Rotación y compras"],["caja","Caja"],["auditoria","Auditoría"]].map(x=><button key={x[0]} className={tab===x[0]?"active":""} onClick={()=>setTab(x[0])}>{x[1]}</button>)}</div>
      {tab==="resumen" && <><div className="grid2"><Panel padded><h2>Evolución diaria de ventas</h2><SalesChart data={daily}/></Panel><Panel padded><h2>Recaudo por medio de pago</h2><Bars data={payments} label="method" value="amount" /></Panel></div><div className="grid2 subsection"><Panel padded><h2>Ventas por categoría</h2><Bars data={categories} label="category" value="sales" /></Panel><Panel title="Desempeño por usuario"><Table headers={["Usuario","Ventas","Transacciones","Margen"]} rows={sellers.map(x=>[x.seller,cop(x.sales),x.transactions,cop(x.margin)])}/></Panel></div></>}
      {tab==="ventas" && <><div className="grid2"><Panel padded><h2>Tendencia del período</h2><SalesChart data={daily}/></Panel><Panel padded><h2>Participación por categoría</h2><Bars data={categories} label="category" value="sales"/></Panel></div><Panel className="subsection" title="Detalle de ventas"><Table headers={["Comprobante","Fecha","Cliente","Vendedor","Total","Costo","Utilidad","Fiado","Estado"]} rows={filteredSales.map(x=>[saleNumber(x,business),dt(x.created),x.customer||"Consumidor final",x.operator,cop(x.total),cop(x.cost),cop(x.total-x.cost),cop(x.original_debt),<Badge tone={x.status==="void"?"red":""}>{x.status==="void"?"Anulada":"Registrada"}</Badge>])}/></Panel></>}
      {tab==="recaudos" && <><Metrics items={[{label:"Total movimientos",value:(history.receivable_moves||[]).filter(x=>x.kind.includes("Abono")).length,note:"Abonos registrados"},{label:"Valor recaudado",value:cop((history.receivable_moves||[]).filter(x=>x.amount<0&&x.kind.includes("Abono")).reduce((n,x)=>n-x.amount,0)),note:"Aplicado a cartera"},{label:"Medios utilizados",value:payments.filter(x=>x.amount>0).length,note:"En el período"},{label:"Cartera restante",value:cop(s.receivables),note:"Saldo actual"}]}/><Panel title="Abonos y documentos afectados"><Table headers={["Fecha","Cliente","Movimiento","Valor aplicado","Saldo posterior","Observación"]} rows={(history.receivable_moves||[]).filter(x=>x.kind.includes("Abono")).map(x=>[dt(x.created),x.customer,x.kind,cop(Math.abs(x.amount)),cop(x.balance_after),x.note||"—"])}/></Panel></>}
      {tab==="inventario" && <><Metrics items={[{label:"Inventario valorizado",value:cop(s.inventory_value),note:"Costo de existencias"},{label:"Reposiciones sugeridas",value:report.suggestions.length,note:"Según consumo y mínimos"},{label:"Productos sin movimiento",value:rotation.filter(x=>!x.sold90).length,note:"90 días"},{label:"Clasificación A",value:rotation.filter(x=>x.abc==="A").length,note:"Mayor participación"}]}/><Panel title="Rotación y sugerencias de compra"><Table headers={["Producto","ABC","Vendido 7/30/90 días","Existencia","Promedio diario","Días disponibles","Compra sugerida"]} rows={rotation.map(x=>[<>{x.name}<small>{x.sku} · {x.rotation}</small></>,<Badge tone={x.abc==="A"?"":"warn"}>{x.abc}</Badge>,`${x.sold7} / ${x.sold30} / ${x.sold90}`,stockLabel(x.stock,x.unit),x.daily_average,x.days_stock??"Sin consumo",x.suggested_qty?stockLabel(x.suggested_qty,x.unit):"—"])}/></Panel></>}
      {tab==="caja" && <Panel title="Historial de cierres y diferencias"><Table headers={["Caja / responsable","Apertura","Ventas efectivo","Recaudos","Otros ingresos","Egresos","Devoluciones","Esperado","Contado","Diferencia / justificación"]} rows={report.cash.map(x=>[<>#{x.id}<small>{x.operator}</small></>,cop(x.opening),cop(x.cash_sales),cop(x.cash_collections),cop(x.other_income),cop(x.expenses),cop(x.cash_refunds),cop(x.expected||0),x.counted==null?"—":cop(x.counted),<><Badge tone={x.difference<0?"red":x.difference>0?"warn":""}>{cop(x.difference||0)} · {x.difference_type||"Pendiente"}</Badge><small>{x.difference_reason}{x.difference_note?` · ${x.difference_note}`:""}</small></>])}/></Panel>}
      {tab==="cartera" && <div className="grid2"><Panel title="Antigüedad de saldos"><Table headers={["Rango","Cuentas","Saldo"]} rows={report.aging.map(x=>[x.bucket,x.accounts,cop(x.amount)])}/></Panel><Panel padded><h2>Distribución de cartera</h2><Bars data={report.aging} label="bucket" value="amount"/></Panel></div>}
      {tab==="kardex" && <Panel title="Kardex de inventario"><Table headers={["Fecha","Producto / lote","Movimiento","Entrada","Salida","Saldo","Costo","Documento","Usuario"]} rows={(history.stock_moves||[]).map(x=>[dt(x.created),<>{x.name}<small>{x.code}</small></>,x.kind,x.qty>0?stockLabel(x.qty,x.unit):"—",x.qty<0?stockLabel(-x.qty,x.unit):"—",stockLabel(x.balance_after,x.unit),cop(x.cost),x.reference,x.operator])}/></Panel>}
      {tab==="productos" && <><Metrics items={[{label:"Productos activos",value:rotation.length,note:"Empresa seleccionada"},{label:"Agotados",value:rotation.filter(x=>x.stock<=0).length,note:"Requieren revisión"},{label:"Bajo mínimo",value:rotation.filter(x=>x.stock<=x.min_stock).length,note:"Incluye agotados"},{label:"Valor del inventario",value:cop(s.inventory_value),note:"A costo"}]}/><Panel title="Inventario y comportamiento"><Table headers={["Producto","Existencia","Mínimo","Máximo","7 / 30 / 90 días","Cobertura","ABC","Estado"]} rows={rotation.map(x=>[<>{x.name}<small>{x.sku}</small></>,stockLabel(x.stock,x.unit),stockLabel(x.min_stock,x.unit),stockLabel(x.max_stock,x.unit),`${x.sold7} / ${x.sold30} / ${x.sold90}`,x.days_stock==null?"Sin consumo":`${x.days_stock} días`,x.abc,<Badge tone={x.stock<=x.min_stock?"red":""}>{x.stock<=0?"Agotado":x.stock<=x.min_stock?"Stock bajo":"Disponible"}</Badge>])}/></Panel></>}
      {tab==="auditoria" && <Panel title="Trazabilidad de acciones"><Table headers={["Fecha","Usuario","Acción","Detalle"]} rows={(history.audit||[]).map(x=>[dt(x.created),x.operator,x.action,<small>{x.detail}</small>])}/></Panel>}
      <Panel className="subsection" padded><h2>Exportar información</h2><p className="muted">Archivos CSV con títulos en español, compatibles con Excel.</p><div className="actions">
            {[
              ["sales", "Ventas"],
              ["payments", "Recaudos"],
              ["debts", "Cartera"],
              ["stock_moves", "Kárdex"],
              ["top", "Productos"],
              ["cash_moves", "Caja"],
              ["audit", "Auditoría"],
            ].map(([id, label]) => (
              <a
                key={id}
                href={`/api/export?business=${business}&start=${start}&end=${end}&kind=${id}`}
              >
                {label} ↗
              </a>
            ))}
          </div><Notice info>El margen es bruto estimado: ventas menos costo de los lotes consumidos.</Notice></Panel>
    </>
  );
}
export function Settings({ state, history, business, onAction }) {
  const b = state.businesses.find((b) => b.id === business);
  return (
    <>
      <Head
        title="Configuración"
        subtitle="Datos del negocio, usuarios y respaldo de la información."
      />
      <div className="grid2">
        <PrinterSettings />
        <Panel padded>
          <h2>{b.name}</h2>
          <p className="muted">
            Estos datos aparecen en los recibos de este negocio.
          </p>
          <p>
            {b.nit || "NIT sin registrar"}
            <br />
            {b.address || "Dirección sin registrar"}
            <br />
            {b.phone || "Teléfono sin registrar"}
          </p>
          <p>
            Papel POS: <b>{b.receipt_width} mm</b>
          </p>
          <Button onClick={() => onAction("business_settings")}>
            Editar datos del negocio
          </Button>
        </Panel>
        <Panel padded>
          <h2>Copia de seguridad</h2>
          <p className="muted">
            Descarga una copia consistente de la base completa. Incluye ambos
            negocios y usuarios; solo el administrador tiene acceso.
          </p>
          <a href={`/api/backup?business=${business}`}>
            Descargar respaldo SQLite ↗
          </a>
          <p className="print-note" style={{ marginTop: 18 }}>
            Guarda una copia al cerrar la jornada en otro dispositivo. Consulta
            la guía del proyecto para restaurar con el servidor detenido.
          </p>
        </Panel>
      </div>
      <Panel
        className="subsection"
        title="Usuarios y permisos"
        action={
          <Button onClick={() => onAction("new_user")}>+ Crear usuario</Button>
        }
      >
        <Table
          headers={["Nombre", "Usuario", "Rol", "Negocios", "Estado", "Acción"]}
          rows={(history.users || []).map((u) => [
            u.name,
            u.username,
            u.role === "admin" ? "Administrador" : "Cajero",
            JSON.parse(u.businesses)
              .map((b) => (b === 1 ? "Mini market" : "Ferretería"))
              .join(" · "),
            <Badge tone={u.active ? "" : "red"}>{u.active ? "Activo" : "Desactivado"}</Badge>,
            <Button onClick={() => onAction("edit_user", u.id)}>Editar permisos</Button>,
          ])}
        />
      </Panel>
      <Panel className="subsection" title="Opciones de producto no registrado" action={<Button onClick={() => onAction("new_unregistered_option")}>+ Nueva opción</Button>}>
        <p className="muted">Estas opciones aparecen en el punto de venta. Puede editar su nombre o desactivarlas sin alterar ventas anteriores.</p>
        <Table headers={["Opción","Estado","Acción"]} rows={(state.unregistered_options || []).map((option)=>[
          option.name,
          <Badge tone={option.active?"":"red"}>{option.active?"Activa":"Desactivada"}</Badge>,
          <Button onClick={()=>onAction("edit_unregistered_option",option.id)}>Editar</Button>,
        ])}/>
      </Panel>
      <Panel className="subsection" padded>
        <div className="split-label">
          <h2>Facturación electrónica</h2>
          <Badge tone="warn">Desactivada · sin proveedor</Badge>
        </div>
        <p className="muted">
          La operación local usa recibos internos. No se transmite ninguna venta
          a la DIAN.
        </p>
        <div className="setup-steps">
          <div className="setup-step">
            <b>1. Preparar los datos</b>Razón social, NIT y datos tributarios;
            identificación y correo de los clientes.
          </div>
          <div className="setup-step">
            <b>2. Elegir proveedor</b>Contratar el servicio y obtener
            credenciales, ambiente de pruebas y documentación de conexión.
          </div>
          <div className="setup-step">
            <b>3. Conectar y habilitar</b>Implementar el adaptador del
            proveedor, pruebas, numeración y manejo de contingencias antes de
            activar.
          </div>
        </div>
        <p className="print-note" style={{ marginTop: 18 }}>
          El proyecto incluye una interfaz de integración y un plan técnico. La
          emisión electrónica requiere implementación con el proveedor elegido.
          Los recibos actuales no son documentos electrónicos validados.
        </p>
      </Panel>
      <Panel className="subsection" padded>
        <h2>Correo saliente</h2>
        <p className="muted">
          {state.smtp_configured
            ? "Servidor SMTP configurado. Envía los recibos desde Ventas y recibos."
            : "Configura las variables SMTP en el computador servidor siguiendo la guía incluida. Las credenciales no se guardan en el navegador."}
        </p>
        <Button onClick={() => onAction("test_email")}>
          Enviar correo de prueba
        </Button>
      </Panel>
    </>
  );
}
