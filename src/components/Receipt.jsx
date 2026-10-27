import React, { useRef } from "react";
import { Modal, Notice, Button } from "./UI.jsx";
export default function Receipt({
  business,
  kind,
  id,
  message,
  auto,
  onClose,
  onEmail,
}) {
  const frame = useRef(null),
    printed = useRef(false);
  const url = `/receipt?business=${business}&kind=${kind}&id=${id}`;
  function print() {
    try {
      frame.current?.contentWindow?.print();
    } catch {
      /* The explicit print button remains available. */
    }
  }
  return (
    <Modal title="Comprobante guardado" onClose={onClose} wide>
      {message && <Notice info>{message}</Notice>}
      <div className="actions" style={{ marginBottom: 14 }}>
        <Button type="button" primary onClick={print}>
          Imprimir recibo
        </Button>
        <a href={url} target="_blank" rel="noopener">
          Abrir / guardar PDF
        </a>
        {kind === "sale" && (
          <Button type="button" onClick={() => onEmail(id)}>
            Enviar por correo
          </Button>
        )}
      </div>
      <iframe
        ref={frame}
        className="receipt-preview"
        title="Recibo para impresora POS"
        src={url}
        onLoad={() => {
          if (auto && !printed.current) {
            printed.current = true;
            print();
          }
        }}
      />
      <p className="print-note">
        Selecciona tu impresora POS y papel de 58 u 80 mm, sin encabezados del
        navegador. Cancelar la impresión no cancela la venta.
      </p>
    </Modal>
  );
}
