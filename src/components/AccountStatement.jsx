import React, { useMemo, useRef } from "react";
import { accountStatementHtml } from "../lib/printer.js";
import { Modal, Notice, Button } from "./UI.jsx";

export default function AccountStatement({ businessName, statement, onClose }) {
  const frame = useRef(null);
  const html = useMemo(() => accountStatementHtml(businessName, statement), [businessName, statement]);
  function printOrSave() {
    frame.current?.contentWindow?.print();
  }
  return (
    <Modal title="Estado de cuenta" onClose={onClose} wide className="account-statement-dialog">
      <Notice info>Revisa el documento. Al seleccionar “Imprimir / guardar PDF” puedes escoger una impresora o guardarlo como PDF.</Notice>
      <div className="actions account-statement-actions">
        <Button type="button" primary onClick={printOrSave}>Imprimir / guardar PDF</Button>
        <Button type="button" onClick={onClose}>Cerrar</Button>
      </div>
      <iframe ref={frame} className="receipt-preview account-statement-preview" title="Vista previa del estado de cuenta" srcDoc={html} />
    </Modal>
  );
}
