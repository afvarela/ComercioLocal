import React, { useState } from "react";
import { Modal, Field, Select, MoneyField, Notice } from "./UI.jsx";
import photoCredits from "../lib/photo-credits.json";
import {
  cop,
  qty,
  stockLabel,
  base,
  methods,
  localDate,
  saleNumber,
  normalize,
  unregisteredTypes,
} from "../lib/format.js";
export default function OperationForm({
  config,
  state,
  history = {},
  business,
  admin,
  onClose,
  onSubmit,
}) {
  const { type, id } = config;
  const safeHistory = history || {},
    products = state.products || [],
    customers = state.customers || [],
    lots = state.lots || [],
    businesses = state.businesses || [],
    product = products.find((p) => p.id === id) || {},
    customer = customers.find((c) => c.id === id) || {},
    lot = lots.find((l) => l.id === id) || {},
    sale = (safeHistory.debts || []).find((s) => s.id === id) || {},
    editedUser = (safeHistory.users || []).find((x) => x.id === id) || {},
    b = businesses.find((item) => item.id === business);
  const [unit, setUnit] = useState(product.unit || "und");
  const [basis, setBasis] = useState(product.price_basis || 500);
  const [selectedProduct, setSelectedProduct] = useState(
    type === "receive" ? "" : products[0]?.id || "",
  );
  const [receiveSearch, setReceiveSearch] = useState("");
  const returnLines = config.sale?.lines ||
    (safeHistory.sale_lines || []).filter((line) => Number(line.sale_id) === Number(id));
  const [selectedSaleLine, setSelectedSaleLine] = useState(returnLines[0]?.id || "");
  const returnLine = returnLines.find((line) => Number(line.id) === Number(selectedSaleLine));
  const receiving = products.find(
    (p) => p.id === Number(selectedProduct),
  );
  const receivingVegetable = business === 1 && receiving?.category === "Verduras";
  let title = "",
    body = null,
    submit = "Guardar";
  switch (type) {
    case "photo_credits":
      return (
        <Modal title="Créditos de las fotografías" onClose={onClose} wide>
          <p className="muted">
            Fotografías ilustrativas de Wikimedia Commons, disponibles también
            sin internet. Algunas variedades pueden diferir de la mercancía
            real.
          </p>
          <div className="photo-credits">
            {photoCredits.map((p) => (
              <div key={p.file}>
                <img
                  src={"/images/" + p.file}
                  alt={p.file.replace(".jpg", "")}
                />
                <div>
                  <b>{p.file.replace(".jpg", "").replaceAll("-", " ")}</b>
                  <p>
                    {p.author}
                    <br />
                    <a href={p.source} target="_blank" rel="noreferrer">
                      Fuente original
                    </a>{" "}
                    ·{" "}
                    {p.licenseUrl ? (
                      <a href={p.licenseUrl} target="_blank" rel="noreferrer">
                        {p.license}
                      </a>
                    ) : (
                      p.license
                    )}
                    <br />
                    <small>{p.changes}</small>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      );
    case "quantity": {
      const p = config.product;
      title = p.name;
      submit = "Agregar · Enter";
      body = (
        <>
          <p className="muted">
            {p.description || p.sku} · {cop(p.price)} por{" "}
            {base(p.unit, p.price_basis)}
          </p>
          <Field
            name="qty"
            label={
              p.unit === "g"
                ? "Peso en gramos"
                : ["m","litro","libra"].includes(p.unit)
                  ? `Cantidad en ${p.unit}${p.unit==="litro"?"s":"s"}`
                  : "Cantidad"
            }
            type="number"
            defaultValue={config.initial}
            min={p.unit === "m" ? 0.001 : 1}
            step={p.unit === "m" ? 0.001 : 1}
            required
          />
          {p.unit === "g" && (
            <div className="gram-rate">
              {cop(p.price)} por {base(p.unit, p.price_basis)} (
              {p.price_basis || 1000} g) ·{" "}
              {cop(p.price / (p.price_basis || 1000))} por gramo
            </div>
          )}
          <small>
            Disponible: {stockLabel(p.available, p.unit)}
            {p.unit === "g"
              ? " · Ingresa el peso obtenido en una báscula externa."
              : ""}
          </small>
        </>
      );
      break;
    }
    case "product":
      title = id ? "Editar producto" : "Nuevo producto";
      body = (
        <div className="form-grid">
          <Field
            name="name"
            label="Nombre del producto"
            defaultValue={product.name || ""}
            required
          />
          <Field
            name="sku"
            label="Referencia / SKU"
            defaultValue={product.sku || ""}
            required
          />
          <Field
            name="barcode"
            label="Código de barras (opcional)"
            defaultValue={product.barcode || ""}
          />
          <Field
            name="category"
            label="Categoría"
            defaultValue={product.category || ""}
          />
          <Select
            name="unit"
            label="Unidad de venta"
            value={unit}
            disabled={!!id}
            onChange={(e) => setUnit(e.target.value)}
          >
            <option value="und">Unidad</option>
            <option value="g">Gramos (precio por kilogramo)</option>
            <option value="m">Metros</option>
          </Select>
          {id && <input type="hidden" name="unit" value={unit} />}
          {unit === "g" && (
            <Select
              name="price_basis"
              label="Base del precio por peso"
              value={basis}
              onChange={(e) => setBasis(Number(e.target.value))}
            >
              <option value="500">Libra (500 gramos)</option>
              <option value="1000">Kilogramo (1.000 gramos)</option>
            </Select>
          )}
          <MoneyField
            name="price"
            label={`Precio final por ${base(unit, basis)}`}
            defaultValue={(product.price || 0) / 100}
          />
          <Field
            name="min_stock"
            label={`Stock mínimo en ${unit}`}
            type="number"
            min="0"
            step={unit === "m" ? 0.001 : 1}
            defaultValue={qty(product.min_stock || 0, unit)}
          />
          <Field name="reorder_point" label={`Punto de pedido en ${unit}`} type="number" min="0" step={unit === "m" ? 0.001 : 1} defaultValue={qty(product.reorder_point || 0, unit)} />
          <Field name="max_stock" label={`Existencia objetivo en ${unit}`} type="number" min="0" step={unit === "m" ? 0.001 : 1} defaultValue={qty(product.max_stock || 0, unit)} />
          <Field name="lead_time_days" label="Tiempo de entrega del proveedor (días)" type="number" min="0" max="365" step="1" defaultValue={product.lead_time_days ?? 3} />
          <div className="field">
            <label>Control de vencimiento</label>
            <label className="check">
              <input
                type="checkbox"
                name="perishable"
                defaultChecked={!!product.perishable}
              />
              Producto perecedero
            </label>
          </div>
          <div className="wide">
            <Field
              name="description"
              label="Descripción / marca / medida"
              defaultValue={product.description || ""}
            />
          </div>
        </div>
      );
      break;
    case "receive":
      title = "Recibir mercancía";
      submit = "Registrar entrada";
      body = (
        <>
          <div className="field product-receive-search">
            <label htmlFor="receive-product-search">Buscar producto</label>
            <input id="receive-product-search" autoFocus value={receiveSearch} onChange={(event) => setReceiveSearch(event.target.value)} placeholder="Escribe nombre, referencia o codigo de barras" autoComplete="off" />
            <input type="hidden" name="product_id" value={selectedProduct} />
            <div className="customer-results">
              {state.products.filter((item) => normalize(`${item.name} ${item.sku} ${item.barcode || ""}`).includes(normalize(receiveSearch))).slice(0, 8).map((item) => <button type="button" key={item.id} className={Number(selectedProduct) === item.id ? "selected" : ""} onClick={() => { setSelectedProduct(String(item.id)); setReceiveSearch(item.name); }}><b>{item.name}</b><small>{item.sku} / existencia {stockLabel(item.available, item.unit)}</small></button>)}
            </div>
            {receiving && <div className="selected-customer">Seleccionado: <b>{receiving.name}</b></div>}
          </div>
          <div className="form-grid">
            <Field name="code" label="Numero de lote (opcional)" placeholder="Se genera automaticamente si se deja vacio" />
            <Field name="expires" label="Fecha de vencimiento (opcional)" type="date" />
            <Field name="qty" label={`Cantidad en ${receiving?.unit || "unidades"}`} type="number" min={receiving?.unit === "m" ? 0.001 : 1} step={receiving?.unit === "m" ? 0.001 : 1} required />
            <MoneyField name="cost" label={`Costo por ${base(receiving?.unit, receiving?.price_basis)}`} defaultValue="0" />
            <MoneyField key={`sale-price-${selectedProduct}`} name="sale_price" label={`Nuevo precio de venta por ${base(receiving?.unit, receiving?.price_basis)}`} defaultValue={(receiving?.price || 0) / 100} />
            <Field name="supplier" label="Proveedor (opcional)" />
            <Field name="reference" label="Factura de compra / remision (opcional)" />
          </div>
          <p className="print-note">El inventario y el costo promedio se actualizan al guardar. El nuevo precio se refleja en el punto de venta.</p>
        </>
      );
      break;
    case "initial_stock":
      title = "Cargar existencia inicial";
      submit = "Agregar al inventario";
      body = (
        <>
          <Notice info>
            Para mercancía que ya tenías y cuyo lote no conoces. El sistema la
            agrupará como lote INICIAL y quedará disponible para vender de inmediato.
          </Notice>
          <Select
            name="product_id"
            label="Producto"
            value={selectedProduct}
            onChange={(e) => setSelectedProduct(e.target.value)}
          >
            {state.products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · existencia actual: {stockLabel(p.available, p.unit)}
              </option>
            ))}
          </Select>
          <div className="form-grid">
            <Field
              name="qty"
              label={`Cantidad inicial en ${receiving?.unit || "unidades"}`}
              type="number"
              min={receiving?.unit === "m" ? 0.001 : 1}
              step={receiving?.unit === "m" ? 0.001 : 1}
              required
            />
            <MoneyField
              name="cost"
              label={`Costo aproximado por ${base(receiving?.unit, receiving?.price_basis)}`}
              defaultValue="0"
            />
          </div>
          <Field name="note" label="Observación opcional" placeholder="Ejemplo: mercancía existente al iniciar el sistema" />
        </>
      );
      break;
    case "waste":
      title = "Merma o ajuste de salida";
      body = (
        <>
          <p>
            {lot.name} · lote {lot.code} · {stockLabel(lot.qty, lot.unit)}
          </p>
          <Field
            name="qty"
            label={`Cantidad en ${lot.unit}`}
            type="number"
            min={lot.unit === "m" ? 0.001 : 1}
            step={lot.unit === "m" ? 0.001 : 1}
            required
          />
          <Field
            name="reason"
            label="Motivo (vencido, avería, diferencia de conteo…)"
            required
          />
        </>
      );
      break;
    case "void_purchase": {
      const purchase = (safeHistory.purchases || []).find((p) => p.id === id);
      title = `Anular compra COMP-${String(purchase?.number || 0).padStart(6, "0")}`;
      submit = "Confirmar anulación";
      body = <><Notice>Solo se anulará si toda la mercancía pendiente de esa compra continúa disponible.</Notice><Field name="reason" label="Motivo de la anulación" required /></>;
      break;
    }
    case "purchase_return": {
      const line = (safeHistory.purchase_lines || []).find((l) => l.id === id);
      title = "Devolución de compra";
      submit = "Registrar devolución";
      body = <><p>{line?.name} · COMP-{String(line?.purchase_number || 0).padStart(6, "0")}</p><Field name="qty" label={`Cantidad en ${line?.unit || "unidades"}`} type="number" min="1" max={(line?.qty || 0)-(line?.returned_qty || 0)} required /><Field name="reason" label="Motivo" required /><Field name="note" label="Observaciones" /></>;
      break;
    }
    case "manual_purchase_return":
      title = "Devolución manual a proveedor";
      submit = "Registrar devolución";
      body = <><Select name="lot_id" label="Producto / lote">{state.lots.map((l)=><option key={l.id} value={l.id}>{l.name} · {l.code} · {stockLabel(l.qty,l.unit)}</option>)}</Select><Field name="supplier" label="Proveedor" /><Field name="qty" label="Cantidad" type="number" min="1" required /><MoneyField name="cost" label="Costo de referencia" defaultValue="0" /><Field name="reason" label="Motivo" required /><Field name="note" label="Observaciones" /></>;
      break;
    case "sale_return": {
      title = "Devolución de cliente";
      submit = "Registrar devolución";
      body = returnLines.length ? <><Notice>Factura {saleNumber(config.sale || { number: 0 }, business)}. Selecciona el producto y la cantidad que regresó el cliente.</Notice><Select name="sale_line_id" label="Producto de la factura" value={selectedSaleLine} onChange={(e)=>setSelectedSaleLine(e.target.value)}>{returnLines.map((l)=>{const available=l.qty-(l.returned_qty||0);return <option key={l.id} value={l.id}>{l.name} · disponible para devolver: {qty(available,l.unit)} {l.unit}</option>;})}</Select><Field key={selectedSaleLine} name="qty" label={`Cantidad a devolver${returnLine ? ` (máximo ${qty(returnLine.qty-(returnLine.returned_qty||0),returnLine.unit)} ${returnLine.unit})` : ""}`} type="number" min={returnLine?.unit === "m" ? "0.001" : "1"} step={returnLine?.unit === "m" ? "0.001" : "1"} max={returnLine ? qty(returnLine.qty-(returnLine.returned_qty||0),returnLine.unit) : undefined} required /><Select name="method" label="Método de devolución">{methods.map((m)=><option key={m}>{m}</option>)}</Select><label className="check"><input type="checkbox" name="restock" value="1" defaultChecked /> Reingresar producto al inventario</label><Field name="reason" label="Motivo" required /><Field name="note" label="Estado del producto / observaciones" /></> : <Notice>Esta factura ya no tiene productos disponibles para devolver.</Notice>;
      break;
    }
    case "customer":
      title = id ? "Editar cliente" : "Nuevo cliente";
      body = (
        <>
          <div className="form-grid">
            <Field
              name="name"
              label="Nombre completo / razón social"
              defaultValue={customer.name || ""}
              required
            />
            <Field
              name="document"
              label="Documento / NIT"
              defaultValue={customer.document || ""}
            />
            <Field
              name="phone"
              label="Teléfono"
              type="tel"
              defaultValue={customer.phone || ""}
            />
            <Field
              name="email"
              label="Correo electrónico"
              type="email"
              defaultValue={customer.email || ""}
            />
            {admin && (
              <MoneyField
                name="credit_limit"
                label="Cupo máximo para fiados"
                defaultValue={(customer.credit_limit || 0) / 100}
              />
            )}
          </div>
          <p className="print-note">
            El cupo en cero impide fiar. Solo el administrador asigna o aumenta
            el cupo.
          </p>
        </>
      );
      break;
    case "repay":
      title = "Registrar abono";
      submit = "Guardar abono";
      body = (
        <>
          <p>
            {sale.customer} · {saleNumber(sale, business)}
          </p>
          <div className="pay-total">{cop(sale.debt)}</div>
          <MoneyField
            name="amount"
            label="Valor del abono"
            defaultValue={sale.debt / 100}
          />
          <Select name="method" label="Medio de pago">
            {methods.map((m) => (
              <option key={m}>{m}</option>
            ))}
          </Select>
          <Field name="reference" label="Referencia / comprobante" />
        </>
      );
      break;
    case "open_cash":
      title = "Abrir caja";
      submit = "Abrir caja e imprimir";
      body = (
        <>
          <MoneyField
            name="opening"
            label="Dinero base en efectivo"
            defaultValue="0"
          />
          <Field name="note" label="Detalle de apertura / denominaciones" />
        </>
      );
      break;
    case "unregistered_product":
      title = "Producto no registrado";
      submit = "Agregar a la venta";
      body = <><Notice info>Este ítem no descontará inventario.</Notice><Select name="description" label="Tipo de producto" defaultValue="OTROS">{unregisteredTypes.map((type)=><option key={type} value={type}>{type}</option>)}</Select><Field name="qty" label="Cantidad" type="number" min="1" step="1" defaultValue="1" required/><MoneyField name="price" label="Precio a facturar por unidad" defaultValue="0"/></>;
      break;
    case "cash_move":
      title = "Entrada o retiro de efectivo";
      body = (
        <>
          <Select name="direction" label="Tipo de movimiento">
            <option value="in">Entrada de efectivo</option>
            <option value="out">Retiro / gasto en efectivo</option>
          </Select>
          <MoneyField name="amount" label="Valor" defaultValue="0" />
          <Field name="reason" label="Motivo / soporte" required />
        </>
      );
      break;
    case "close_cash":
      title = "Arqueo y cierre de caja";
      submit = "Confirmar cierre";
      body = (
        <>
          <Notice info>
            Efectivo esperado: <b>{cop(state.cash?.expected)}</b>. Cuenta solo
            billetes y monedas. Los medios electrónicos aparecen separados en el
            recibo.
          </Notice>
          <MoneyField
            name="counted"
            label="Efectivo contado físicamente"
            defaultValue="0"
          />
          <Select name="difference_reason" label="Motivo si existe diferencia">
            <option value="">Sin diferencia</option>
            <option>Error de conteo</option>
            <option>Gasto no registrado</option>
            <option>Ingreso no registrado</option>
            <option>Dinero entregado o retirado</option>
            <option>Otro</option>
          </Select>
          <Field name="difference_note" label="Descripción de la diferencia" />
          <Field
            name="note"
            label="Observaciones / explicación de diferencia"
          />
        </>
      );
      break;
    case "customer_payment":
      title = "Registrar abono del cliente";
      submit = "Aplicar a facturas antiguas";
      body = <><Notice info>El valor se aplica automáticamente a las facturas pendientes más antiguas. El recibo mostrará cómo fue distribuido.</Notice><input type="hidden" name="customer_id" value={config.id}/><MoneyField name="amount" label="Valor recibido" defaultValue="0"/><Select name="method" label="Medio de pago"><option>Efectivo</option><option>Nequi</option><option>Daviplata</option><option>Bancolombia</option><option>Datáfono</option></Select><Field name="reference" label="Referencia u observación"/></>;
      break;
    case "quote":
      title = "Guardar cotización";
      submit = "Guardar cotización";
      body = (
        <>
          <p>
            Total actual: <b>{cop(config.total)}</b>
          </p>
          <Field
            name="valid_until"
            label="Válida hasta"
            type="date"
            defaultValue={localDate(15)}
            required
          />
          <Field name="note" label="Condiciones / observaciones" />
        </>
      );
      break;
    case "settings":
      title = "Datos del negocio";
      body = (
        <>
          <Field
            name="name"
            label="Nombre comercial"
            defaultValue={b.name}
            required
          />
          <Field name="nit" label="NIT / identificación" defaultValue={b.nit} />
          <Field name="address" label="Dirección" defaultValue={b.address} />
          <Field name="phone" label="Teléfono" defaultValue={b.phone} />
          <Field
            name="email"
            label="Correo del negocio"
            type="email"
            defaultValue={b.email || ""}
          />
          <Select
            name="receipt_width"
            label="Ancho de papel POS"
            defaultValue={b.receipt_width}
          >
            <option value="80">80 mm</option>
            <option value="58">58 mm</option>
          </Select>
        </>
      );
      break;
    case "user":
      title = id ? "Editar usuario y permisos" : "Crear usuario";
      body = (
        <>
          <Field name="name" label="Nombre" defaultValue={editedUser.name||""} required />
          <Field name="username" label="Usuario" defaultValue={editedUser.username||""} required autoComplete="off" />
          <Field name="password" label={id?"Nuevo PIN (opcional)":"PIN de acceso (4 números)"} type="password" required={!id} inputMode="numeric" pattern="[0-9]{4}" minLength="4" maxLength="4" autoComplete="new-password" />
          <Select name="role" label="Rol" defaultValue={editedUser.role||"cashier"}><option value="cashier">Cajero</option><option value="admin">Administrador</option></Select>
          <Select name="access" label="Negocios autorizados" defaultValue={editedUser.businesses?(JSON.parse(editedUser.businesses).length===2?"both":String(JSON.parse(editedUser.businesses)[0])):"both"}><option value="both">Ambos negocios</option><option value="1">Solo mini market</option><option value="2">Solo ferreter?a</option></Select>
          <h3>Permisos de Contabilidad por negocio</h3>
          {[1,2].map((businessId)=><fieldset className="finance-permissions" key={businessId}><legend>{businessId===1?"Mini market":"Ferretería"}</legend>{[["view","Ver"],["create","Crear"],["edit","Editar"],["void","Anular"],["authorize","Aprobar pagos y retiros"],["export","Exportar informaci?n"]].map(([key,label])=><label className="check" key={key}><input type="checkbox" name={`finance_${businessId}_${key}`} defaultChecked={Boolean((safeHistory.finance_permissions||[]).find(x=>x.user_id===id&&x.business_id===businessId)?.[`can_${key}`])}/>{label}</label>)}</fieldset>)}
          <h3>Permisos de Lácteos caseros</h3>
          <fieldset className="finance-permissions"><legend>Recaudo de terceros</legend>{[["view","Consultar módulo"],["price","Modificar precios"],["void","Anular o devolver"],["close","Realizar cuadre diario"],["reopen","Reabrir días cerrados"]].map(([key,label])=><label className="check" key={key}><input type="checkbox" name={`dairy_${key}`} defaultChecked={Boolean((safeHistory.dairy_permissions||[]).find(x=>x.user_id===id)?.[`can_${key}`])}/>{label}</label>)}</fieldset>
          {id&&<label className="check"><input type="checkbox" name="active" defaultChecked={Boolean(editedUser.active)}/>Usuario activo</label>}
        </>
      );
      break;
    case "change_password":
      title = "Cambiar PIN";
      body = (
        <>
          <Field
            name="current"
            label="PIN actual"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            minLength="4"
            maxLength="4"
            autoComplete="current-password"
            required
          />
          <Field
            name="password"
            label="Nuevo PIN"
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            minLength="4"
            maxLength="4"
            autoComplete="new-password"
            required
          />
        </>
      );
      break;
    case "email": {
      title = "Enviar recibo por correo";
      submit = "Agregar a la cola";
      const sale = (safeHistory.sales || []).find((s) => s.id === id),
        client = state.customers.find((c) => c.id === sale?.customer_id);
      body = (
        <>
          <Field
            name="recipient"
            label="Correo del destinatario"
            type="email"
            defaultValue={client?.email || ""}
            required
          />
          <p className="print-note">
            Se agregará a la cola de envíos. Pulsa Enviar pendientes cuando haya
            conexión y el correo esté configurado.
          </p>
        </>
      );
      break;
    }
    case "quote_email": {
      title = "Enviar cotización por correo";
      submit = "Agregar a la cola";
      const quote = (safeHistory.quotes || []).find((q) => q.id === id);
      body = (
        <>
          <Field
            name="recipient"
            label="Correo del cliente"
            type="email"
            defaultValue={quote?.customer_email || ""}
            required
          />
          <p className="print-note">
            Se generará y adjuntará la cotización profesional en PDF.
          </p>
        </>
      );
      break;
    }
    case "test_email":
      title = "Probar correo saliente";
      submit = "Enviar prueba";
      body = (
        <Field name="recipient" label="Enviar prueba a" type="email" required />
      );
      break;
    case "void_sale":
      title = "Anular venta y devolver existencias";
      submit = "Confirmar anulación";
      body = (
        <>
          <Notice>
            Se devolverán todos los productos a sus lotes originales y se
            registrarán los reversos. Realiza también la devolución del dinero.
            Solo aplica a ventas sin abonos de la caja abierta.
          </Notice>
          <Field name="reason" label="Motivo de la anulación" required />
        </>
      );
      break;
    case "clear_cart":
      title = "Vaciar venta actual";
      submit = "Vaciar";
      body = (
        <p>
          Se quitarán los productos de esta venta sin registrar movimientos.
        </p>
      );
      break;
    default:
      return null;
  }
  return (
    <Modal title={title} onClose={onClose} onSubmit={onSubmit} submit={submit}>
      {body}
    </Modal>
  );
}
