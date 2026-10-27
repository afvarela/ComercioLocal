import io, zipfile
from datetime import datetime
from xml.sax.saxutils import escape

MONEY='#,##0.00;[Red]-#,##0.00'; PERCENT='0.00%'; INTEGER='#,##0'; DECIMAL='#,##0.00'

def _cell(ref,value,style=0):
    if isinstance(value,(int,float)) and not isinstance(value,bool): return f'<c r="{ref}" s="{style}"><v>{value}</v></c>'
    return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t>{escape(str(value or ""))}</t></is></c>'

def _col(n):
    out=''
    while n: n,r=divmod(n-1,26);out=chr(65+r)+out
    return out

def _sheet(rows,widths,freeze=1,filter_row=None,table_name=None):
    xml=['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetViews><sheetView workbookViewId="0">']
    if freeze: xml.append(f'<pane ySplit="{freeze}" topLeftCell="A{freeze+1}" activePane="bottomLeft" state="frozen"/>')
    xml.append('</sheetView></sheetViews><cols>')
    for i,w in enumerate(widths,1): xml.append(f'<col min="{i}" max="{i}" width="{w}" customWidth="1"/>')
    xml.append('</cols><sheetData>')
    for r,row in enumerate(rows,1):
        xml.append(f'<row r="{r}" ht="{28 if r==1 else 20}" customHeight="1">')
        for c,item in enumerate(row,1):
            value,style=item if isinstance(item,tuple) else (item,0);xml.append(_cell(f'{_col(c)}{r}',value,style))
        xml.append('</row>')
    xml.append('</sheetData>')
    if filter_row and rows: xml.append(f'<autoFilter ref="A{filter_row}:{_col(len(rows[filter_row-1]))}{len(rows)}"/>')
    xml.append('</worksheet>');return ''.join(xml)

def inventory_xlsx(business,user,items,filters):
    generated=datetime.now().strftime('%d/%m/%Y %H:%M'); money=lambda cents:((cents or 0)/100,4)
    counts={k:sum(1 for x in items if x['status']==k) for k in ('Agotado','Stock crítico','Stock bajo','Stock adecuado','Sobreinventario')}
    total_cost=sum(x['inventory_cost'] for x in items);total_sale=sum(x['inventory_sale'] for x in items)
    summary=[[(f'{business["name"].upper()} - INVENTARIO DISPONIBLE',1)],[(f'Generado: {generated}  |  Usuario: {user["name"]}',2)],[(f'Filtros: {filters or "Todos los productos"}',2)],[],[('Indicador',3),('Valor',3)],['Total de productos',len(items)],['Unidades disponibles',sum(x['stock'] for x in items)],['Valor al costo',money(total_cost)],['Valor potencial de venta',money(total_sale)],['Margen potencial',money(total_sale-total_cost)]]
    summary += [[status,counts[status]] for status in counts]
    cats={}
    for x in items:
        c=x['category'] or 'Sin categoría';d=cats.setdefault(c,[0,0,0]);d[0]+=1;d[1]+=x['stock'];d[2]+=x['inventory_cost']
    summary += [[],[('Resumen por categoría',1)], [('Categoría',3),('Productos',3),('Unidades',3),('Valor inventario',3)]]+[[k,v[0],v[1],money(v[2])] for k,v in sorted(cats.items())]
    headers=['Código','Código de barras','Producto','Descripción','Categoría','Unidad','Stock disponible','Stock mínimo','Stock máximo','Stock objetivo','Costo unitario','Precio de venta','Valor al costo','Valor potencial de venta','Margen unitario','Margen %','Última compra','Última venta','Proveedor principal','Estado','Días de cobertura']
    detail=[[(h,3) for h in headers]]
    for x in items: detail.append([x['sku'],x['barcode'],x['name'],x['description'],x['category'],x['unit'],(x['stock'],5),(x['min_stock'],5),(x['max_stock'],5),(x['target_stock'],5),money(x['current_cost']),money(x['price']),money(x['inventory_cost']),money(x['inventory_sale']),money(x['unit_margin']),(x['margin_rate'],6),x['last_purchase'],x['last_sale'],x['supplier'],(x['status'],7 if x['status'] in ('Agotado','Stock crítico') else 8),x['days_stock'] if x['days_stock'] is not None else 'Sin consumo'])
    critical=[detail[0]]+[row for row,x in zip(detail[1:],items) if x['status'] in ('Agotado','Stock crítico','Stock bajo')]
    valuation=[[('Categoría',3),('Productos',3),('Unidades',3),('Valor al costo',3),('Venta potencial',3),('Margen potencial',3)]]+[[k,v[0],v[1],money(v[2]),money(sum(x['inventory_sale'] for x in items if (x['category'] or 'Sin categoría')==k)),money(sum(x['inventory_sale']-x['inventory_cost'] for x in items if (x['category'] or 'Sin categoría')==k))] for k,v in sorted(cats.items())]
    sheets=[('Resumen',summary,[28,20,20,22]),('Inventario Disponible',detail,[15,18,28,35,20,12,17,15,15,16,16,16,18,22,16,12,16,16,24,18,18]),('Stock Crítico',critical,[15,18,28,35,20,12,17,15,15,16,16,16,18,22,16,12,16,16,24,18,18]),('Valoración',valuation,[25,15,18,20,22,22])]
    files={}; rels=[]
    for i,(name,rows,widths) in enumerate(sheets,1):
        files[f'xl/worksheets/sheet{i}.xml']=_sheet(rows,widths,1,1 if i>1 else None,'Inventario' if i==2 else None);rels.append(f'<sheet name="{escape(name)}" sheetId="{i}" r:id="rId{i}"/>')
    files['[Content_Types].xml']='<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'+''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(1,5))+'</Types>'
    files['_rels/.rels']='<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    files['xl/workbook.xml']='<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+''.join(rels)+'</sheets></workbook>'
    files['xl/_rels/workbook.xml.rels']='<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+''.join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in range(1,5))+'<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
    files['xl/styles.xml']='''<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="4"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]-#,##0.00"/><numFmt numFmtId="165" formatCode="0.00%"/><numFmt numFmtId="166" formatCode="#,##0"/><numFmt numFmtId="167" formatCode="#,##0.00"/></numFmts><fonts count="3"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="18"/><color rgb="FF174D36"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF174D36"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE4B5"/></patternFill></fill></fills><borders count="1"><border/></borders><cellXfs count="9"><xf/><xf fontId="1"/><xf applyAlignment="1"><alignment wrapText="1"/></xf><xf fontId="2" fillId="2" applyFill="1" applyFont="1" applyAlignment="1"><alignment wrapText="1"/></xf><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="166" applyNumberFormat="1"/><xf numFmtId="165" applyNumberFormat="1"/><xf fillId="3" applyFill="1"/><xf applyAlignment="1"><alignment horizontal="center"/></xf></cellXfs></styleSheet>'''
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        for name,data in files.items():z.writestr(name,data)
    return out.getvalue()

def report_xlsx(business,user,title,start,end,headers,data,money_columns=(),total_columns=()):
    generated=datetime.now().strftime('%d/%m/%Y %H:%M'); rows=[[(f'{business["name"].upper()} - {title.upper()}',1)],[(f'Período: {start} al {end}',2)],[(f'Generado: {generated}  |  Usuario: {user["name"]}',2)],[],[(h,3) for h in headers]]
    for source in data:
        row=[]
        for i,value in enumerate(source): row.append(((value or 0)/100,4) if i in money_columns and isinstance(value,(int,float)) else value)
        rows.append(row)
    if total_columns:
        total=['TOTAL' if i==0 else (sum((r[i] or 0) for r in data)/100,4) if i in total_columns else '' for i in range(len(headers))];rows.append(total)
    widths=[max(13,min(38,max([len(str(h))]+[len(str(r[i] or '')) for r in data[:200]])+2)) for i,h in enumerate(headers)]
    files={'[Content_Types].xml':'<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>','_rels/.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>','xl/workbook.xml':'<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Reporte" sheetId="1" r:id="rId1"/></sheets></workbook>','xl/_rels/workbook.xml.rels':'<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>','xl/styles.xml':'<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00;[Red]-#,##0.00"/><numFmt numFmtId="166" formatCode="#,##0"/></numFmts><fonts count="3"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="18"/><color rgb="FF174D36"/></font><font><b/><color rgb="FFFFFFFF"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF174D36"/></patternFill></fill></fills><borders count="1"><border/></borders><cellXfs count="9"><xf/><xf fontId="1"/><xf/><xf fontId="2" fillId="2"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="166" applyNumberFormat="1"/><xf/><xf/><xf/></cellXfs></styleSheet>'}
    files['xl/worksheets/sheet1.xml']=_sheet(rows,widths,5,5)
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
        for name,value in files.items():z.writestr(name,value)
    return out.getvalue()
