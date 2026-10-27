"""Shared 58/80 mm product layout for sales and dispatch receipts."""
import textwrap


def receipt_money(value):
    return "$ " + f"{int(value or 0) / 100:,.2f}"


def line_total(line):
    if line.get("total") is not None:
        return int(line["total"])
    qty = int(line.get("qty") or 0)
    price = int(line.get("price") or 0)
    unit = line.get("unit") or "und"
    divisor = max(1, int(line.get("price_basis") or 1000)) if unit == "g" else 1000 if unit == "m" else 1
    return round(qty * price / divisor)


def product_receipt_lines(lines, width, product_name_width=None):
    """Render products once; both POS sales and dispatches call this function."""
    product_name_width = min(width, int(product_name_width or width))
    value_width = min(14, max(10, width // 3))
    result = ["PRODUCTO".ljust(width - value_width) + "VALOR".rjust(value_width), "-" * width]
    for item in lines:
        unit = item.get("unit") or "und"
        qty = item.get("qty") or 0
        shown_qty = qty / 1000 if unit in ("m", "litro", "libra") else qty
        basis = ("libra (500 g)" if int(item.get("price_basis") or 1000) == 500 else "kg") if unit == "g" else unit
        # Product names use a narrower line on thermal receipts so a long
        # description cannot reach the printer's non-printable right edge.
        result.extend(textwrap.wrap(str(item.get("name") or "Producto"), product_name_width) or [""])
        detail = f"{shown_qty:g} {unit} \u00d7 {receipt_money(item.get('price'))}/{basis}"
        total = receipt_money(line_total(item))
        if len(detail) + len(total) <= width:
            result.append(detail.ljust(width - len(total)) + total)
        else:
            result.extend(textwrap.wrap(detail, width))
            result.append(total.rjust(width))
        result.append("-" * width)
    return result


def pos_product_receipt_lines(lines, width):
    """Formato compacto y seguro usado únicamente por el recibo de venta POS."""
    value_width = min(13, max(10, width // 3))
    name_width = width - value_width - 1

    def row(label, value=""):
        return str(label)[:name_width].ljust(name_width) + " " + str(value)[:value_width].rjust(value_width)

    result = [row("PRODUCTO", "VALOR"), "-" * width]
    for item in lines:
        unit = item.get("unit") or "und"
        qty = item.get("qty") or 0
        shown_qty = qty / 1000 if unit in ("m", "litro", "libra") else qty
        basis = ("libra (500 g)" if int(item.get("price_basis") or 1000) == 500 else "kg") if unit == "g" else unit
        names = textwrap.wrap(str(item.get("name") or "Producto"), name_width) or [""]
        total = receipt_money(line_total(item))
        result.append(row(names[0], total))
        result.extend(row(name) for name in names[1:])
        detail = f"{shown_qty:g} {unit} × {receipt_money(item.get('price'))}/{basis}"
        result.extend(textwrap.wrap(detail, width) or [detail])
        result.append("-" * width)
    return result
