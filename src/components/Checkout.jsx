import React, { useMemo, useState } from "react";
import { Modal, Field, Notice, Button } from "./UI.jsx";
import { cop, methods, localDate, qty, unregisteredLinePayload } from "../lib/format.js";
import { filterCustomers } from "../lib/customers.js";
import { initialPayments, updatePayment, paymentState, keypadValue } from "../lib/payments.js";

const icons = ["$", "N", "D", "B", "▣"];

export default function Checkout({ total, business, cart, customers, customerId, requestId, quoteId, onClose, onSave }) {
  const [values, setValues] = useState(() => initialPayments(total));
  const [credit, setCredit] = useState(false);
  const [client, setClient] = useState(customerId || "");
  const [customerSearch, setCustomerSearch] = useState("");
  const [activeMethod, setActiveMethod] = useState("Efectivo");
  const [replaceValue, setReplaceValue] = useState(true);
  const [keypadOpen, setKeypadOpen] = useState(false);
  const payment = paymentState(total, values);
  const matchingCustomers = useMemo(() => {
    return filterCustomers(customers, customerSearch, 8);
  }, [customers, customerSearch]);

  function setPayment(method, value) {
    setValues((current) => updatePayment(total, current, method, value));
  }
  function activate(method) {
    setActiveMethod(method);
    setReplaceValue(true);
    if (method !== "Efectivo" && !values[method]) setPayment(method, String(total / 100));
  }
  function pressKey(key) {
    setPayment(activeMethod, keypadValue(values[activeMethod], key, replaceValue));
    setReplaceValue(false);
  }
  async function submit(data) {
    if (payment.excessElectronic) throw Error("Los medios electrónicos superan el total. Corrige sus valores antes de cobrar.");
    if (payment.remaining && !credit) throw Error(`Efectivo insuficiente. Faltan ${cop(payment.remaining)} para completar la venta.`);
    if (credit && !client) throw Error("Busca y selecciona el cliente responsable del fiado.");
    await onSave({
      lines: cart.filter((line) => !line.unregistered&&!line.dairy).map((line) => ({ product_id: line.id, qty: qty(line.qty, line.unit) })),
      dairy_lines: cart.filter((line) => line.dairy).map((line) => ({ product_id: line.dairy_product_id, qty: qty(line.qty, line.unit) })),
      unregistered_lines: cart.filter((line) => line.unregistered).map(unregisteredLinePayload),
      payments: methods.map((method) => ({ method, amount: values[method] || 0 })),
      customer_id: Number(client) || null,
      allow_credit: credit,
      due: data.due,
      request_id: requestId,
      quote_id: quoteId,
      cash_received: payment.cash,
      change_given: payment.change,
      _print_receipt: data.print_receipt !== "0",
    });
  }

  return (
    <Modal title="Cobrar venta" className="checkout-dialog" onClose={onClose} onSubmit={submit} wide actions={<div className="dialog-actions"><Button type="button" onClick={onClose}>Cancelar</Button><Button type="submit" name="print_receipt" value="0">Confirmar sin imprimir</Button><Button primary type="submit" name="print_receipt" value="1">Confirmar e imprimir</Button></div>}>
      <div className="checkout-total"><span>Total de la venta</span><strong>{cop(total)}</strong></div>
      <p className="payment-help">Todo inicia en efectivo. Al escribir en otro medio, el efectivo se ajusta solo.</p>
      <div className="payment-list">
        {methods.map((method, index) => (
          <div className={`payment-method method-${index} ${activeMethod === method ? "active" : ""}`} key={method} onClick={() => activate(method)}>
            <span className="payment-icon" aria-hidden="true">{icons[index]}</span>
            <label htmlFor={`payment-${index}`}>{index === 0 ? "Efectivo recibido" : method}{index === 0 && <small>Saldo automático</small>}</label>
            <div className="payment-value"><span>$</span><input id={`payment-${index}`} aria-label={`Valor en ${method}`} inputMode="decimal" type="number" min="0" step="0.01" placeholder="0" value={values[method]} onFocus={(event) => { activate(method); event.target.select(); }} onClick={(event) => { event.stopPropagation(); activate(method); if (business === 1) setKeypadOpen(true); }} onChange={(event) => setPayment(method, event.target.value)} /></div>
          </div>
        ))}
      </div>
      {business === 1 && keypadOpen && (
        <div className="keypad-backdrop" role="dialog" aria-modal="true" aria-label={`Teclado numérico para ${activeMethod}`}>
        <div className="numeric-pad">
          <div className="numeric-pad-head"><span>Valor recibido en <b>{activeMethod}</b></span><button type="button" className="close" onClick={() => setKeypadOpen(false)}>×</button></div>
          <div className="numeric-pad-value">{cop(Math.round(Number(values[activeMethod] || 0) * 100))}</div>
          <div className="numeric-pad-grid">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"].map((key) => <button type="button" key={key} onClick={() => pressKey(key)}>{key}</button>)}
            <button type="button" className="numeric-clear" onClick={() => { setPayment(activeMethod, ""); setReplaceValue(true); }}>Borrar valor</button>
            <button type="button" className="numeric-accept primary" onClick={() => setKeypadOpen(false)}>Aceptar valor</button>
          </div>
        </div>
        </div>
      )}
      {payment.excessElectronic && <Notice>El pago electrónico supera la venta en {cop(payment.electronic - total)}. Corrige el valor.</Notice>}
      <div className={`pay-balance ${payment.remaining ? "pending" : ""}`}><span>{payment.change ? "Cambio a entregar" : payment.remaining ? "Saldo pendiente" : "Pago completo"}</span><b>{cop(payment.change || payment.remaining || payment.paid)}</b></div>
      {!!payment.cash && <div className="cash-summary"><span>Recibido en efectivo <b>{cop(payment.cash)}</b></span><span>Cambio <b>{cop(payment.change)}</b></span></div>}
      <div className="check"><input id="allow-credit" type="checkbox" checked={credit} onChange={(event) => { setCredit(event.target.checked); setValues(event.target.checked ? Object.fromEntries(methods.map((method) => [method, 0])) : initialPayments(total)); }} /><label htmlFor="allow-credit" className="no-margin">Dejar saldo fiado al cliente</label></div>
      {credit && (
        <div className="credit-customer-search">
          <Field name="customer_search" label="Buscar cliente por nombre o cédula" value={customerSearch} onChange={(event) => setCustomerSearch(event.target.value)} autoComplete="off" placeholder="Escribe nombre o número de documento" />
          <div className="customer-results">
            {matchingCustomers.map((customer) => <button type="button" key={customer.id} className={Number(client) === customer.id ? "selected" : ""} onClick={() => setClient(String(customer.id))}><b>{customer.name}</b><small>CC {customer.document || "Sin documento"} · saldo {cop(customer.balance)}</small></button>)}
          </div>
          {client && <div className="selected-customer">Cliente seleccionado: <b>{customers.find((customer) => customer.id === Number(client))?.name}</b></div>}
          <Field name="due" label="Fecha acordada de pago" type="date" defaultValue={localDate(15)} required />
          <p className="print-note">Para fiar una parte, registra el valor recibido. El faltante quedará a cargo del cliente seleccionado.</p>
        </div>
      )}
      <p className="print-note" style={{ marginTop: 17 }}>Si entregan más efectivo, escribe el dinero recibido y se calculará el cambio.</p>
    </Modal>
  );
}


