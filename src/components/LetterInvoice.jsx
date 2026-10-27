import React, { useRef, useState } from "react";
import { Modal, Button, Notice } from "./UI.jsx";
import { downloadInvoicePdf } from "../lib/api.js";

export default function LetterInvoice({ id, onClose, onWhatsApp }) {
  const frame = useRef(null);
  const [downloadError, setDownloadError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const preview = `/invoice?business=2&id=${id}`;
  async function download() {
    setDownloading(true);
    setDownloadError("");
    try {
      await downloadInvoicePdf(id);
    } catch (error) {
      setDownloadError(error.message);
    } finally {
      setDownloading(false);
    }
  }
  return (
    <Modal
      title="Factura tamaño carta"
      onClose={onClose}
      wide
      className="letter-invoice-dialog"
    >
      <Notice info>
        Documento comercial de la ferretería con productos, datos legales,
        cliente, medios de pago y totales.
      </Notice>
      <div className="actions letter-invoice-actions">
        <Button type="button" primary onClick={() => frame.current?.contentWindow?.print()}>
          Imprimir / guardar PDF
        </Button>
        <Button type="button" className="invoice-download" disabled={downloading} onClick={download}>
          {downloading ? "Generando PDFâ€¦" : "Descargar factura PDF"}
        </Button>
        <Button type="button" onClick={() => onWhatsApp(id)}>
          Enviar por WhatsApp Web
        </Button>
        <a href={preview} target="_blank" rel="noopener">
          Abrir en otra pestaña
        </a>
      </div>
      {downloadError && <div className="form-error" role="alert">{downloadError}</div>}
      <iframe
        ref={frame}
        className="letter-invoice-preview"
        title="Vista previa de factura tamaño carta"
        src={preview}
      />
      <p className="print-note">
        WhatsApp Web no permite adjuntar archivos automáticamente. La opción
        descarga el PDF y abre el chat con el mensaje preparado para que lo
        adjuntes.
      </p>
    </Modal>
  );
}
