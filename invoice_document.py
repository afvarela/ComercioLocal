"""Factura comercial tamaño carta para las ventas de ferretería."""
from __future__ import annotations

import html
import io
import textwrap

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether
except ImportError:
    colors = letter = getSampleStyleSheet = ParagraphStyle = mm = None
    SimpleDocTemplate = Paragraph = Spacer = Table = TableStyle = KeepTogether = None


def money(value):
    raw = f"{int(value or 0) / 100:,.2f}"
    return "$ " + raw.replace(",", "X").replace(".", ",").replace("X", ".")


def quantity_label(line):
    value = line["qty"] / 1000 if line["unit"] in ("m", "litro", "libra") else line["qty"]
    return f"{value:g}"


def price_unit(line):
    if line["unit"] == "g":
        return "libra (500 g)" if int(line.get("price_basis") or 1000) == 500 else "kg"
    return line["unit"]


def invoice_html(business, sale):
    e = lambda value: html.escape(str(value or ""))
    customer = sale.get("customer") or {}
    rows = []
    for index, line in enumerate(sale.get("lines") or [], 1):
        rows.append(
            f"<tr><td>{index}</td><td><b>{e(line.get('name'))}</b>"
            f"<small>{e(line.get('sku'))} · {e(line.get('description'))}</small></td>"
            f"<td class='num'>{e(quantity_label(line))}</td><td>{e(line.get('unit'))}</td>"
            f"<td class='num'>{e(money(line.get('price')))} / {e(price_unit(line))}</td>"
            f"<td class='num'><b>{e(money(line.get('total')))}</b></td></tr>"
        )
    payment_rows = "".join(
        f"<p><span>{e(payment.get('method'))}</span><b>{e(money(payment.get('amount')))}</b></p>"
        for payment in sale.get("payments") or []
        if payment.get("amount")
    ) or "<p><span>Saldo fiado</span><b>{}</b></p>".format(e(money(sale.get("debt"))))
    status = "<div class='void'>ANULADA</div>" if sale.get("status") == "void" else ""
    code = e(sale["code"])
    return f'''<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Factura {code}</title>
<style>
@page{{size:letter;margin:13mm}}*{{box-sizing:border-box}}body{{margin:0;background:#ecebe7;color:#292719;font:13px Arial,sans-serif}}.toolbar{{position:sticky;top:0;z-index:2;display:flex;justify-content:center;gap:10px;padding:12px;background:#292719}}.toolbar button,.toolbar a{{border:0;border-radius:7px;padding:10px 16px;background:#ffd238;color:#342900;font-weight:700;text-decoration:none;cursor:pointer}}.sheet{{position:relative;width:216mm;min-height:279mm;margin:20px auto;padding:16mm;background:#fff;box-shadow:0 10px 35px #0002}}header{{display:grid;grid-template-columns:minmax(0,1fr) 230px;gap:24px;padding-bottom:19px;border-bottom:5px solid #ffd238}}.business h1{{margin:0 0 8px;color:#3d3316;font-size:29px;line-height:1.1}}.business p,.document p{{margin:4px 0;line-height:1.55}}.document{{text-align:right}}.document h2{{margin:0 0 10px;color:#5b4211;font-size:22px}}.document strong{{font-size:20px}}.parties{{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:20px 0}}.box{{border:1px solid #d9d3c2;border-radius:9px;padding:13px;background:#fffdf7}}.box h3{{margin:0 0 8px;color:#735614;font-size:12px;text-transform:uppercase;letter-spacing:.8px}}.box p{{margin:3px 0;line-height:1.45}}table{{width:100%;border-collapse:collapse;table-layout:fixed}}th{{padding:10px 8px;background:#3b3524;color:#fff;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px}}td{{padding:10px 8px;border-bottom:1px solid #e5e0d3;vertical-align:top;overflow-wrap:anywhere}}td small{{display:block;margin-top:4px;color:#766f5d;font-size:10px}}th:nth-child(1){{width:6%}}th:nth-child(2){{width:36%}}th:nth-child(3){{width:10%}}th:nth-child(4){{width:10%}}th:nth-child(5){{width:19%}}th:nth-child(6){{width:19%}}.num{{text-align:right}}.summary{{display:grid;grid-template-columns:1fr 290px;gap:28px;margin-top:22px}}.payments h3{{margin:0 0 9px;font-size:13px}}.payments p,.totals p{{display:flex;justify-content:space-between;gap:20px;margin:7px 0}}.totals{{border:1px solid #d9d3c2;border-radius:9px;padding:14px}}.totals .grand{{margin:12px -14px -14px;padding:15px 14px;background:#5b4211;color:#fff;border-radius:0 0 8px 8px;font-size:20px}}footer{{position:absolute;left:16mm;right:16mm;bottom:13mm;padding-top:12px;border-top:1px solid #d9d3c2;color:#655f50;font-size:10px;line-height:1.45}}.void{{position:absolute;top:45%;left:18%;transform:rotate(-20deg);font-size:82px;font-weight:900;color:#b12b2130;border:8px solid #b12b2130;padding:12px;z-index:1}}@media(max-width:850px){{.sheet{{width:100%;min-height:0;margin:0;padding:22px}}header,.parties,.summary{{grid-template-columns:1fr}}.document{{text-align:left}}footer{{position:static;margin-top:28px}}table{{min-width:760px}}.table-scroll{{overflow:auto}}}}@media print{{body{{background:#fff}}.toolbar{{display:none}}.sheet{{width:auto;min-height:253mm;margin:0;padding:0;box-shadow:none}}footer{{left:0;right:0;bottom:0}}}}
</style></head><body><div class="toolbar"><button onclick="window.print()">Imprimir / guardar PDF</button><a href="/invoice.pdf?business=2&id={int(sale['id'])}" download>Descargar PDF</a></div><main class="sheet">{status}<header><section class="business"><h1>{e(business.get('name'))}</h1><p><b>NIT:</b> {e(business.get('nit') or 'No registrado')}<br><b>Direcci&oacute;n:</b> {e(business.get('address') or 'No registrada')}<br><b>Tel&eacute;fono:</b> {e(business.get('phone') or 'No registrado')}<br><b>Correo:</b> {e(business.get('email') or 'No registrado')}</p></section><section class="document"><h2>FACTURA DE VENTA</h2><strong>{code}</strong><p>Fecha: {e(str(sale.get('created',''))[:10])}<br>Atendido por: {e(sale.get('operator'))}<br>Estado: {'Anulada' if sale.get('status') == 'void' else 'Registrada'}</p></section></header><section class="parties"><div class="box"><h3>Facturado a</h3><p><b>{e(customer.get('name') or 'Consumidor final')}</b><br>Documento: {e(customer.get('document') or 'No registrado')}<br>Tel&eacute;fono: {e(customer.get('phone') or 'No registrado')}<br>Correo: {e(customer.get('email') or 'No registrado')}</p></div><div class="box"><h3>Informaci&oacute;n del documento</h3><p>Documento comercial de la venta registrada.<br>Caja: #{e(sale.get('cash_id'))}<br>{'Fecha acordada de pago: ' + e(sale.get('due')) if sale.get('due') else 'Venta sin fecha de pago pendiente.'}</p></div></section><div class="table-scroll"><table><thead><tr><th>#</th><th>Producto / descripci&oacute;n</th><th class="num">Cant.</th><th>Unidad</th><th class="num">Valor unitario</th><th class="num">Subtotal</th></tr></thead><tbody>{''.join(rows)}</tbody></table></div><section class="summary"><div class="payments"><h3>Medios de pago</h3>{payment_rows}{f'<p><span>Cambio entregado</span><b>{e(money(sale.get("change_given")))}</b></p>' if sale.get('change_given') else ''}</div><div class="totals"><p><span>Subtotal</span><b>{e(money(sale.get('total')))}</b></p><p><span>Impuestos</span><b>Incluidos cuando apliquen</b></p><p><span>Saldo pendiente</span><b>{e(money(sale.get('debt')))}</b></p><p class="grand"><span>TOTAL</span><b>{e(money(sale.get('total')))}</b></p></div></section><footer><b>{e(business.get('name'))}</b> · NIT {e(business.get('nit') or 'No registrado')}<br>Comprobante interno de la operaci&oacute;n. No es factura electr&oacute;nica ni documento equivalente electr&oacute;nico validado por la DIAN. Conserve este documento para cambios, garant&iacute;as y control de la compra.</footer></main></body></html>'''


def _simple_pdf(lines):
    safe = [str(line).encode("latin-1", "replace").decode("latin-1").replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") for line in lines]
    pages = [safe[i:i + 45] for i in range(0, len(safe), 45)] or [[]]
    objects = [b"<< /Type /Catalog /Pages 2 0 R >>"]
    objects.append(f"<< /Type /Pages /Kids [{' '.join(f'{3+i*2} 0 R' for i in range(len(pages)))}] /Count {len(pages)} >>".encode())
    font_id = 3 + len(pages) * 2
    for index, page in enumerate(pages):
        page_id = 3 + index * 2
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {page_id+1} 0 R >>".encode())
        stream = ("BT /F1 10 Tf 48 750 Td 14 TL\n" + "\n".join(f"({line}) Tj T*" for line in page) + "\nET").encode("latin-1")
        objects.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    out = bytearray(b"%PDF-1.4\n"); offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(out)); out.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(out); out.extend(f"xref\n0 {len(objects)+1}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]: out.extend(f"{offset:010d} 00000 n \n".encode())
    out.extend(f"trailer << /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return bytes(out)


def _designed_pdf(business, sale):
    pages = []
    commands = []
    y = 0

    def safe(value):
        return str(value or "").encode("latin-1", "replace").decode("latin-1").replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    def text(x, at, size, value, bold=False, color="0 0 0"):
        commands.append(f"{color} rg BT /{'F2' if bold else 'F1'} {size} Tf {x} {at} Td ({safe(value)}) Tj ET")

    def line(x1, y1, x2, y2, color=".82 .78 .65", width=.6):
        commands.append(f"{color} RG {width} w {x1} {y1} m {x2} {y2} l S")

    def rect(x, at, width, height, color):
        commands.append(f"{color} rg {x} {at} {width} {height} re f")

    def page_header():
        nonlocal commands, y
        commands = []
        rect(0, 720, 612, 72, ".23 .21 .14")
        rect(0, 716, 612, 4, "1 .82 .22")
        business_lines = textwrap.wrap(str(business.get("name") or ""), 28)[:2] or [""]
        name_size = 18 if len(business_lines) == 1 else 15
        name_y = 757 if len(business_lines) == 1 else 766
        for name_index, name_line in enumerate(business_lines):
            text(46, name_y - name_index * 17, name_size, name_line, True, "1 1 1")
        text(46, 737 if len(business_lines) == 1 else 727, 9, f"NIT: {business.get('nit') or 'No registrado'}  |  {business.get('phone') or ''}", False, "1 1 1")
        text(410, 758, 14, "FACTURA DE VENTA", True, "1 .82 .22")
        text(464, 739, 12, sale["code"], True, "1 1 1")
        y = 694

    def finish_page():
        pages.append("\n".join(commands))
        page_header()

    def table_header():
        nonlocal y
        rect(42, y - 19, 528, 24, ".23 .21 .14")
        text(48, y - 12, 8, "#", True, "1 1 1")
        text(68, y - 12, 8, "PRODUCTO / DESCRIPCION", True, "1 1 1")
        text(340, y - 12, 8, "CANT.", True, "1 1 1")
        text(385, y - 12, 8, "UNIDAD", True, "1 1 1")
        text(440, y - 12, 8, "V. UNITARIO", True, "1 1 1")
        text(520, y - 12, 8, "SUBTOTAL", True, "1 1 1")
        y -= 27

    page_header()
    text(46, y, 9, f"Direccion: {business.get('address') or 'No registrada'}")
    text(320, y, 9, f"Fecha: {str(sale.get('created') or '')[:10]}")
    y -= 16
    text(46, y, 9, f"Correo: {business.get('email') or 'No registrado'}")
    text(320, y, 9, f"Atendido por: {sale.get('operator') or ''}")
    y -= 25
    customer = sale.get("customer") or {}
    rect(42, y - 49, 528, 58, ".99 .98 .94")
    line(42, y + 9, 570, y + 9, ".75 .69 .48", 1)
    text(50, y - 4, 8, "FACTURADO A", True, ".45 .33 .08")
    text(50, y - 20, 11, customer.get("name") or "Consumidor final", True)
    text(50, y - 35, 8, f"Documento: {customer.get('document') or 'No registrado'}  Telefono: {customer.get('phone') or 'No registrado'}")
    text(335, y - 20, 8, f"Caja: #{sale.get('cash_id')}")
    text(335, y - 35, 8, f"Estado: {'Anulada' if sale.get('status') == 'void' else 'Registrada'}")
    y -= 70
    table_header()
    for index, item in enumerate(sale.get("lines") or [], 1):
        names = textwrap.wrap(str(item.get("name") or ""), 42)[:2] or [""]
        height = max(37, 19 + len(names) * 10)
        if y - height < 155:
            finish_page()
            table_header()
        text(48, y - 12, 8, index)
        for name_index, part in enumerate(names):
            text(68, y - 11 - name_index * 10, 8, part, name_index == 0)
        text(68, y - 11 - len(names) * 10, 7, f"{item.get('sku') or ''} - {item.get('description') or ''}")
        text(340, y - 12, 8, quantity_label(item))
        text(385, y - 12, 8, item.get("unit"))
        text(430, y - 12, 8, f"{money(item.get('price'))}/{price_unit(item)}")
        text(512, y - 12, 8, money(item.get("total")), True)
        line(42, y - height, 570, y - height, ".88 .85 .77", .4)
        y -= height
    if y < 190:
        finish_page()
    y -= 10
    text(310, y, 9, "Subtotal")
    text(485, y, 9, money(sale.get("total")), True)
    y -= 18
    text(310, y, 9, "Saldo pendiente")
    text(485, y, 9, money(sale.get("debt")), True)
    y -= 29
    rect(300, y - 11, 270, 35, ".36 .26 .07")
    text(315, y, 13, "TOTAL", True, "1 1 1")
    text(470, y, 13, money(sale.get("total")), True, "1 1 1")
    y -= 38
    text(46, y, 9, "MEDIOS DE PAGO", True, ".45 .33 .08")
    y -= 15
    payments = sale.get("payments") or [{"method": "Saldo fiado", "amount": sale.get("debt")}]
    for payment in payments:
        text(46, y, 8, f"{payment.get('method')}: {money(payment.get('amount'))}")
        y -= 13
    line(42, 84, 570, 84)
    text(46, 68, 7, f"{business.get('name') or ''} - NIT {business.get('nit') or 'No registrado'}", True, ".35 .32 .25")
    text(46, 54, 7, "Comprobante interno. No es factura electronica ni documento equivalente electronico validado por la DIAN.")
    text(46, 42, 7, "Conserve este documento para cambios, garantias y control de la compra.")
    pages.append("\n".join(commands))
    objects = [None, b"<< /Type /Catalog /Pages 2 0 R >>"]
    font_regular = 3 + len(pages) * 2
    font_bold = font_regular + 1
    kids = " ".join(f"{3 + index * 2} 0 R" for index in range(len(pages)))
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode())
    for index, content in enumerate(pages):
        page_id = 3 + index * 2
        stream_id = page_id + 1
        objects.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font_regular} 0 R /F2 {font_bold} 0 R >> >> /Contents {stream_id} 0 R >>".encode())
        stream = content.encode("latin-1", "replace")
        objects.append(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>")
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>")
    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for object_id, obj in enumerate(objects[1:], 1):
        offsets.append(len(output))
        output.extend(f"{object_id} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(output)
    output.extend(f"xref\n0 {len(objects)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        output.extend(f"{offset:010d} 00000 n \n".encode())
    output.extend(f"trailer << /Size {len(objects)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF".encode())
    return bytes(output)


def invoice_pdf(business, sale):
    customer = sale.get("customer") or {}
    if not SimpleDocTemplate:
        return _designed_pdf(business, sale)
    out = io.BytesIO()
    doc = SimpleDocTemplate(out, pagesize=letter, rightMargin=14*mm, leftMargin=14*mm, topMargin=13*mm, bottomMargin=17*mm, title=f"Factura {sale['code']}")
    styles = getSampleStyleSheet()
    title = ParagraphStyle("InvoiceTitle", parent=styles["Title"], textColor=colors.HexColor("#5b4211"), fontSize=23, leading=26, spaceAfter=4)
    meta = ParagraphStyle("InvoiceMeta", parent=styles["Normal"], fontSize=9, leading=13, textColor=colors.HexColor("#514a38"))
    cell = ParagraphStyle("InvoiceCell", parent=styles["Normal"], fontSize=8, leading=10)
    story = [Table([[Paragraph(html.escape(business.get("name", "")), title), Paragraph(f"<b>FACTURA DE VENTA</b><br/><font size='14'>{html.escape(sale['code'])}</font><br/>Fecha: {html.escape(str(sale.get('created',''))[:10])}", meta)]], colWidths=[118*mm, 62*mm], style=TableStyle([("VALIGN", (0,0), (-1,-1), "TOP"), ("ALIGN", (1,0), (1,0), "RIGHT"), ("LINEBELOW", (0,0), (-1,-1), 4, colors.HexColor("#ffd238")), ("BOTTOMPADDING", (0,0), (-1,-1), 10)])), Spacer(1, 4*mm), Table([[Paragraph(f"<b>NIT:</b> {html.escape(business.get('nit') or 'No registrado')}<br/><b>Dirección:</b> {html.escape(business.get('address') or 'No registrada')}<br/><b>Teléfono:</b> {html.escape(business.get('phone') or 'No registrado')}<br/><b>Correo:</b> {html.escape(business.get('email') or 'No registrado')}", meta), Paragraph(f"<b>CLIENTE</b><br/>{html.escape(customer.get('name') or 'Consumidor final')}<br/>Documento: {html.escape(customer.get('document') or 'No registrado')}<br/>Teléfono: {html.escape(customer.get('phone') or 'No registrado')}<br/>Atendido por: {html.escape(sale.get('operator') or '')}", meta)]], colWidths=[90*mm, 90*mm], style=TableStyle([("BOX", (0,0), (-1,-1), .6, colors.HexColor("#d9d3c2")), ("INNERGRID", (0,0), (-1,-1), .4, colors.HexColor("#e8e3d6")), ("BACKGROUND", (0,0), (-1,-1), colors.HexColor("#fffdf7")), ("VALIGN", (0,0), (-1,-1), "TOP"), ("PADDING", (0,0), (-1,-1), 9)])), Spacer(1, 5*mm)]
    data = [["#", "Producto / descripción", "Cant.", "Unidad", "Valor unitario", "Subtotal"]]
    for index, item in enumerate(sale.get("lines") or [], 1):
        description = f"<b>{html.escape(item.get('name') or '')}</b><br/><font size='7'>{html.escape(item.get('sku') or '')} · {html.escape(item.get('description') or '')}</font>"
        data.append([str(index), Paragraph(description, cell), quantity_label(item), item.get("unit", ""), f"{money(item.get('price'))} / {price_unit(item)}", money(item.get("total"))])
    table = Table(data, colWidths=[9*mm, 66*mm, 18*mm, 18*mm, 34*mm, 35*mm], repeatRows=1)
    table.setStyle(TableStyle([("BACKGROUND", (0,0), (-1,0), colors.HexColor("#3b3524")), ("TEXTCOLOR", (0,0), (-1,0), colors.white), ("FONTNAME", (0,0), (-1,0), "Helvetica-Bold"), ("FONTSIZE", (0,0), (-1,-1), 8), ("GRID", (0,0), (-1,-1), .35, colors.HexColor("#ded8c9")), ("VALIGN", (0,0), (-1,-1), "TOP"), ("ALIGN", (2,1), (2,-1), "RIGHT"), ("ALIGN", (4,1), (-1,-1), "RIGHT"), ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#fffdf7")]), ("TOPPADDING", (0,0), (-1,-1), 7), ("BOTTOMPADDING", (0,0), (-1,-1), 7)]))
    payments = "<b>Medios de pago</b><br/>" + "<br/>".join(f"{html.escape(p.get('method') or '')}: {money(p.get('amount'))}" for p in sale.get("payments") or [] if p.get("amount"))
    if not sale.get("payments"): payments += f"<br/>Saldo fiado: {money(sale.get('debt'))}"
    summary = Table([[Paragraph(payments, meta), Paragraph(f"Subtotal: <b>{money(sale.get('total'))}</b><br/>Saldo pendiente: <b>{money(sale.get('debt'))}</b><br/><font size='15'><b>TOTAL: {money(sale.get('total'))}</b></font>", meta)]], colWidths=[95*mm, 85*mm], style=TableStyle([("VALIGN", (0,0), (-1,-1), "TOP"), ("ALIGN", (1,0), (1,0), "RIGHT"), ("BOX", (1,0), (1,0), .8, colors.HexColor("#5b4211")), ("BACKGROUND", (1,0), (1,0), colors.HexColor("#fff8db")), ("PADDING", (0,0), (-1,-1), 10)]))
    footer = Paragraph(f"<b>{html.escape(business.get('name') or '')}</b> · NIT {html.escape(business.get('nit') or 'No registrado')}<br/>Comprobante interno de la operación. No es factura electrónica ni documento equivalente electrónico validado por la DIAN. Conserve este documento para cambios, garantías y control de la compra.", meta)
    story += [table, Spacer(1, 5*mm), KeepTogether([summary, Spacer(1, 8*mm), footer])]
    doc.build(story)
    return out.getvalue()
