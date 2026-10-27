import React, { useEffect, useRef, useState } from "react";
export function Button({
  children,
  primary = false,
  accent = false,
  ...props
}) {
  return (
    <button
      {...props}
      className={`${primary ? "primary " : accent ? "accent " : ""}${props.className || ""}`}
    >
      {children}
    </button>
  );
}
export function Head({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
export function Field({ name, label, ...props }) {
  return (
    <div className="field">
      <label htmlFor={`f-${name}`}>{label}</label>
      <input id={`f-${name}`} name={name} {...props} />
    </div>
  );
}
export function Select({ name, label, children, ...props }) {
  return (
    <div className="field">
      <label htmlFor={`f-${name}`}>{label}</label>
      <select id={`f-${name}`} name={name} {...props}>
        {children}
      </select>
    </div>
  );
}
export function MoneyField({ name, label, ...props }) {
  return (
    <Field
      name={name}
      label={label}
      type="number"
      min="0"
      step="0.01"
      required
      {...props}
    />
  );
}
export function Badge({ children, tone = "" }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Notice({ children, info = false }) {
  return <div className={`notice ${info ? "info" : ""}`}>{children}</div>;
}
export function Table({ headers, rows }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={headers.length}>
                <div className="empty">
                  Todavía no hay registros en esta sección.
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
export function Panel({
  title,
  action,
  children,
  padded = false,
  className = "",
}) {
  return (
    <section className={`panel ${padded ? "panel-pad" : ""} ${className}`}>
      {title && (
        <div className="section-title">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export function Metrics({ items }) {
  return (
    <div className="metrics">
      {items.map((m, i) => (
        <div key={m.label} className={`metric ${i === 0 ? "featured" : ""}`}>
          <label>{m.label}</label>
          <strong>{m.value}</strong>
          {m.note && <small>{m.note}</small>}
        </div>
      ))}
    </div>
  );
}
export function Modal({
  title,
  onClose,
  onSubmit,
  submit = "Guardar",
  children,
  wide = false,
  actions = null,
  className = "",
}) {
  const ref = useRef(null),
    pending = useRef(false);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    const first = d.querySelector("input:not([type=checkbox]),select,textarea");
    first?.focus();
    if (first?.type === "number") first.select();
    return () => d.close();
  }, []);
  async function handle(e) {
    e.preventDefault();
    if (pending.current || !onSubmit) return;
    pending.current = true;
    setLoading(true);
    setError("");
    try {
      const values = Object.fromEntries(new FormData(e.currentTarget));
      const submitter = e.nativeEvent?.submitter;
      if (submitter?.name) values[submitter.name] = submitter.value;
      await onSubmit(values, e.currentTarget);
    } catch (e) {
      setError(e.message);
    } finally {
      pending.current = false;
      setLoading(false);
    }
  }
  return (
    <dialog
      ref={ref}
      className={`${wide ? "receipt-dialog" : ""} ${className}`.trim()}
      onCancel={(e) => {
        if (pending.current) e.preventDefault();
        else onClose();
      }}
    >
      <div className="dialog-header">
        <h2>{title}</h2>
        <button
          className="close"
          aria-label="Cerrar"
          disabled={loading}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <form onSubmit={handle}>
        {error && (
          <div className="form-error" role="alert" style={{ display: "block" }}>
            {error}
          </div>
        )}
        {children}
        {onSubmit && (actions || (
          <div className="dialog-actions">
            <Button type="button" disabled={loading} onClick={onClose}>
              Cancelar
            </Button>
            <Button primary type="submit" disabled={loading}>
              {loading ? "Guardando…" : submit}
            </Button>
          </div>
        ))}
      </form>
    </dialog>
  );
}
export function DateRange({ start, end, onApply }) {
  const [a, setA] = useState(start),
    [b, setB] = useState(end);
  return (
    <div className="date-range">
      <input
        aria-label="Fecha inicial"
        type="date"
        value={a}
        onChange={(e) => setA(e.target.value)}
      />
      <span>al</span>
      <input
        aria-label="Fecha final"
        type="date"
        value={b}
        onChange={(e) => setB(e.target.value)}
      />
      <Button onClick={() => onApply(a, b)}>Aplicar</Button>
    </div>
  );
}
