import html, io, json, re, secrets, textwrap
from datetime import datetime, date
from receipt_layout import product_receipt_lines, receipt_money, line_total

STATUSES=['Pendiente','En preparacion','Listo para entregar','En reparto','Entregado','Entrega parcial','No entregado','Cancelado']
QUICK_STATUSES={'En reparto','Entregado','Cancelado'}
TRANSITIONS={
 'Pendiente':{'En preparacion','Entregado','Cancelado'},'En preparacion':{'Listo para entregar','Entregado','Cancelado'},
 'Listo para entregar':{'En reparto','Entregado','Entrega parcial','No entregado','Cancelado'},
 'En reparto':{'Entregado','Entrega parcial','No entregado'},'En camino':{'Entregado','Entrega parcial','No entregado'},'No entregado':{'En reparto','Entregado','Cancelado'},
 'Entrega parcial':set(),'Entregado':{'Pendiente'},'Cancelado':set()
}
def clean(v,n=500): return str(v or '').strip()[:n]
def now(): return datetime.now().astimezone().isoformat(timespec='seconds')
def rows(db,sql,args=()): return [dict(x) for x in db.execute(sql,args)]
def one(db,sql,args=()):
 r=db.execute(sql,args).fetchone(); return dict(r) if r else None
def require(ok,msg):
 if not ok: raise ValueError(msg)

def logistics_state(store,u,b,search=''):
 with store.connect() as db:
  term=f"%{clean(search).lower()}%"
  sales=rows(db,"""SELECT s.id,s.number,s.created,s.status,s.customer_id,COALESCE(c.name,'Consumidor final') customer,COALESCE(c.phone,'') phone,
   COALESCE((SELECT SUM(sl.qty-COALESCE((SELECT SUM(sr.qty) FROM sales_return_lines sr JOIN sales_returns r ON r.id=sr.return_id WHERE sr.sale_line_id=sl.id),0)-COALESCE((SELECT SUM(CASE WHEN d.status='Entrega parcial' THEN dl.delivered_qty ELSE dl.qty END) FROM dispatch_lines dl JOIN dispatches d ON d.id=dl.dispatch_id WHERE dl.sale_line_id=sl.id AND d.status!='Cancelado'),0)) FROM sale_lines sl WHERE sl.sale_id=s.id),0) pending_qty
   FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.business_id=? AND s.status='active' AND (CAST(s.number AS TEXT) LIKE ? OR lower(COALESCE(c.name,'')) LIKE ? OR COALESCE(c.phone,'') LIKE ?) ORDER BY s.id DESC LIMIT 60""",(b,term,term,term))
  dispatches=rows(db,"""SELECT d.*,s.number sale_number,COALESCE(c.name,'Consumidor final') customer,u.name creator,
   (SELECT COUNT(*) FROM dispatch_lines WHERE dispatch_id=d.id) line_count FROM dispatches d JOIN sales s ON s.id=d.sale_id LEFT JOIN customers c ON c.id=s.customer_id JOIN users u ON u.id=d.created_by WHERE d.business_id=? ORDER BY d.id DESC""",(b,))
  for item in dispatches:item['lines']=rows(db,'SELECT * FROM dispatch_lines WHERE dispatch_id=?',(item['id'],))
  products=rows(db,'SELECT id,sku,barcode,name,category,price FROM products WHERE business_id=? AND active=1 ORDER BY name',(b,))
  settings=one(db,'SELECT * FROM label_settings WHERE business_id=?',(b,))
  return {'sales':sales,'dispatches':dispatches,'products':products,'label_settings':settings,'permissions':{'view':True,'create':True,'update':True,'confirm':True,'cancel':u['role']=='admin','print':True,'labels':True,'configure':u['role']=='admin'}}

def sale_options(store,u,b,sale_id):
 with store.connect() as db:
  sale=one(db,"SELECT s.*,COALESCE(c.name,'Consumidor final') customer,COALESCE(c.phone,'') phone FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=? AND s.business_id=?",(sale_id,b));require(sale and sale['status']=='active','Factura no disponible para despacho')
  lines=rows(db,"""SELECT sl.*,COALESCE((SELECT SUM(sr.qty) FROM sales_return_lines sr JOIN sales_returns r ON r.id=sr.return_id WHERE sr.sale_line_id=sl.id),0) returned_qty,COALESCE((SELECT SUM(CASE WHEN d.status='Entrega parcial' THEN dl.delivered_qty ELSE dl.qty END) FROM dispatch_lines dl JOIN dispatches d ON d.id=dl.dispatch_id WHERE dl.sale_line_id=sl.id AND d.status!='Cancelado'),0) dispatched_qty FROM sale_lines sl WHERE sl.sale_id=? ORDER BY sl.id""",(sale_id,))
  for x in lines:x['pending_qty']=max(0,x['qty']-x['returned_qty']-x['dispatched_qty'])
  sale['lines']=[x for x in lines if x['pending_qty']>0];return sale

def logistics_command(store,u,b,action,d):
 with store.connect() as db:
  db.execute('BEGIN IMMEDIATE')
  if action=='create':
   request=clean(d.get('request_id'));require(len(request)>=16,'Identificador inválido');old=one(db,'SELECT id FROM dispatches WHERE business_id=? AND request_id=?',(b,request))
   if old:return {'ok':True,'id':old['id'],'duplicate':True}
   sale=one(db,"SELECT * FROM sales WHERE id=? AND business_id=? AND status='active'",(int(d.get('sale_id',0)),b));require(sale,'Factura no disponible')
   supplied={int(x['sale_line_id']):int(x['qty']) for x in d.get('lines',[]) if int(x.get('qty',0))>0};require(supplied,'Seleccione cantidades para despachar')
   options=sale_options(store,u,b,sale['id']);available={x['id']:x for x in options['lines']}
   for lid,q in supplied.items():require(lid in available and 0<q<=available[lid]['pending_qty'],'La cantidad supera el saldo pendiente')
   number=one(db,'SELECT COALESCE(MAX(number),0)+1 n FROM dispatches WHERE business_id=?',(b,))['n'];created=now();scheduled=clean(d.get('scheduled_date')) or date.today().isoformat()
   fields=['contact_phone','recipient_name','recipient_phone','address','neighborhood','city','department','reference_point','address_note','instructions','responsible','driver','vehicle_plate','note']
   values=[clean(d.get(x)) for x in fields]
   cur=db.execute(f"INSERT INTO dispatches(business_id,number,sale_id,created,scheduled_date,scheduled_time,{','.join(fields)},created_by,request_id) VALUES({','.join('?' for _ in range(8+len(fields)))})",(b,number,sale['id'],created,scheduled,clean(d.get('scheduled_time')),*values,u['id'],request));dispatch_id=cur.lastrowid
   for lid,q in supplied.items():
    x=available[lid];db.execute('INSERT INTO dispatch_lines(dispatch_id,sale_line_id,product_id,name,sku,unit,qty) VALUES(?,?,?,?,?,?,?)',(dispatch_id,lid,x['product_id'],x['name'],x['sku'],x['unit'],q))
   db.execute('INSERT INTO dispatch_history(dispatch_id,created,user_id,to_status,note) VALUES(?,?,?,?,?)',(dispatch_id,created,u['id'],'Pendiente','Despacho creado'))
   db.execute('INSERT INTO audit(business_id,user_id,created,action,detail) VALUES(?,?,?,?,?)',(b,u['id'],created,'dispatch_create',json.dumps({'id':dispatch_id,'sale_id':sale['id'],'number':number})))
   return {'ok':True,'id':dispatch_id}
  if action=='status':
   item=one(db,'SELECT * FROM dispatches WHERE id=? AND business_id=?',(int(d.get('id',0)),b));require(item,'Despacho no encontrado');target=clean(d.get('status'));require(target!=item['status'] and (target in QUICK_STATUSES or target in TRANSITIONS.get(item['status'],set())),'Transición de estado no permitida')
   reset_delivery=target in ('Pendiente','En reparto','Cancelado')
   delivered_at=now() if target in ('Entregado','Entrega parcial') else None if reset_delivery else item['delivered_at'];received='' if reset_delivery or target=='Entregado' else clean(d.get('received_by'));note='' if target in QUICK_STATUSES or reset_delivery else clean(d.get('note'),1000)
   lines=rows(db,'SELECT * FROM dispatch_lines WHERE dispatch_id=?',(item['id'],))
   if target=='Entregado':
    for x in lines:db.execute('UPDATE dispatch_lines SET delivered_qty=qty WHERE id=?',(x['id'],))
   elif reset_delivery:
    for x in lines:db.execute('UPDATE dispatch_lines SET delivered_qty=0 WHERE id=?',(x['id'],))
   elif target=='Entrega parcial':
    delivered={int(x['line_id']):int(x['qty']) for x in d.get('lines',[])};require(any(delivered.values()),'Indique al menos una cantidad entregada')
    for x in lines:require(0<=delivered.get(x['id'],0)<=x['qty'],'Cantidad entregada inválida');db.execute('UPDATE dispatch_lines SET delivered_qty=? WHERE id=?',(delivered.get(x['id'],0),x['id']))
   confirmed_by=u['id'] if delivered_at else None if reset_delivery else item['confirmed_by']
   db.execute('UPDATE dispatches SET status=?,delivered_at=?,received_by=?,delivery_note=?,confirmed_by=? WHERE id=?',(target,delivered_at,received,note,confirmed_by,item['id']))
   db.execute('INSERT INTO dispatch_history(dispatch_id,created,user_id,from_status,to_status,note) VALUES(?,?,?,?,?,?)',(item['id'],now(),u['id'],item['status'],target,note));return {'ok':True,'id':item['id']}
  if action=='settings':
   require(u['role']=='admin','Solo el administrador configura etiquetas');fmt=clean(d.get('format'));require(fmt in ('large','small','price'),'Formato inválido')
   nums=[int(d.get(x)) for x in ('width_mm','height_mm','margin_mm','name_size','price_size','barcode_height','gap_mm','row_gap_mm','page_margin_mm','barcode_gap_mm')];require(20<=nums[0]<=80 and 10<=nums[1]<=120 and 0<=nums[2]<=8 and 5<=nums[3]<=28 and 6<=nums[4]<=42 and 3<=nums[5]<=30 and all(0<=x<=8 for x in nums[6:]),'Revise las medidas')
   db.execute('UPDATE label_settings SET format=?,width_mm=?,height_mm=?,margin_mm=?,name_size=?,price_size=?,barcode_height=?,gap_mm=?,row_gap_mm=?,page_margin_mm=?,barcode_gap_mm=?,updated_by=?,updated_at=? WHERE business_id=?',(fmt,*nums,u['id'],now(),b));return {'ok':True}
  raise ValueError('Operación logística inválida')

def dispatch_data(store,b,id):
 with store.connect() as db:
  d=one(db,"SELECT d.*,s.number sale_number,COALESCE(c.name,'Consumidor final') customer,COALESCE(c.phone,'') customer_phone,bu.name business_name,bu.nit,bu.phone business_phone,bu.receipt_width,u.name operator FROM dispatches d JOIN sales s ON s.id=d.sale_id LEFT JOIN customers c ON c.id=s.customer_id JOIN businesses bu ON bu.id=d.business_id JOIN users u ON u.id=d.created_by WHERE d.id=? AND d.business_id=?",(id,b));require(d,'Despacho no encontrado');d['lines']=rows(db,"""SELECT dl.*,sl.price,COALESCE(sl.price_basis,CASE WHEN dl.unit='g' THEN 500 WHEN dl.unit='m' THEN 1000 ELSE 1 END) price_basis,COALESCE(p.description,'') description FROM dispatch_lines dl JOIN sale_lines sl ON sl.id=dl.sale_line_id LEFT JOIN products p ON p.id=dl.product_id WHERE dl.dispatch_id=? ORDER BY dl.id""",(id,));d['history']=rows(db,'SELECT h.*,u.name operator FROM dispatch_history h JOIN users u ON u.id=h.user_id WHERE h.dispatch_id=? ORDER BY h.id',(id,));return d

def dispatch_receipt(store,b,id,text=False):
 d=dispatch_data(store,b,id);code=f"DES-{d['number']:06d}";sale=f"{'MM' if b==1 else 'FE'}-{d['sale_number']:06d}";width=37
 status='EN REPARTO' if d['status'] in ('En camino','En reparto') else d['status'].upper();total=sum(line_total(x) for x in d['lines'])
 centered=lambda value:[line.center(width) for line in (textwrap.wrap(str(value or ''),width) or [''])]
 field=lambda label,value:textwrap.wrap(f'{label}: {value or ""}',width,subsequent_indent='  ') or [f'{label}:']
 out=centered(d['business_name'].upper())+centered(d['nit'])+centered(d['business_phone'])+['']+centered('COMPROBANTE DE DESPACHO')+centered(code)+['']+field('Factura',sale)+field('Atendi\u00f3',d['operator'])+['','-'*width]
 out += product_receipt_lines(d['lines'],width,product_name_width=24)
 out += [('Total '+receipt_money(total)).rjust(width),'-'*width,'']+centered('INFORMACI\u00d3N DE ENTREGA')+['']
 for label,value in [('Cliente',d['customer']),('Tel\u00e9fono',d['contact_phone'] or d['customer_phone']),('Direcci\u00f3n',d['address']),('Barrio/Vereda',d['neighborhood']),('Municipio',d['city']),('Responsable',d['responsible'])]:out += field(label,value)
 out += ['']+field('Estado',status)+['','-'*width]+centered('RECIBIDO A SATISFACCI\u00d3N')+['','Firma:','_'*(width-2),'','Nombre:','_'*(width-2),'','C\u00e9dula:','_'*(width-2),'','-'*width]
 out += textwrap.wrap('Este comprobante corresponde al despacho de los productos relacionados con la factura indicada.',width)+['']+centered('GRACIAS POR SU COMPRA')
 receipt='\n'.join(out)
 if text:return receipt
 safe=html.escape(receipt).encode('ascii','xmlcharrefreplace').decode('ascii')
 receipt_width=80;body_width=76
 return f'''<!doctype html><html lang="es"><head><meta charset="utf-8"><title>{code}</title><style>@page{{size:{receipt_width}mm auto;margin:2mm}}*{{box-sizing:border-box}}body{{width:{body_width}mm;margin:4px auto;color:#111}}pre{{font:10px/1.25 Consolas,"Courier New",monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}}button{{padding:9px;margin-bottom:8px}}@media print{{button{{display:none}}body{{margin:0}}}}</style></head><body><button onclick="print()">Imprimir</button><pre>{safe}</pre></body></html>'''

def labels_html(store,b,payload):
 ids=[int(x['product_id']) for x in payload.get('items',[])];require(ids,'Agregue productos')
 with store.connect() as db:
  products={x['id']:x for x in rows(db,f"SELECT * FROM products WHERE business_id=? AND active=1 AND id IN ({','.join('?'*len(ids))})",(b,*ids))};settings=one(db,'SELECT * FROM label_settings WHERE business_id=?',(b,))
 items=[]
 for raw in payload['items']:
  p=products.get(int(raw['product_id']));count=int(raw.get('count',0));require(p and 0<count<=500,'Producto o cantidad de etiquetas inválida');code=clean(p['barcode'] or p['sku'],80);require(code,'El producto no tiene código imprimible');items += [p]*count
 patterns=["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112"]
 def barcode(value,height):
  require(all(32<=ord(c)<=126 for c in value),'El codigo contiene caracteres no compatibles con Code 128')
  codes=[104]+[ord(c)-32 for c in value];codes += [(104+sum(code*i for i,code in enumerate(codes[1:],1)))%103,106]
  modules=[]
  for code in codes:modules.extend(int(x) for x in patterns[code])
  scale=1.35;x=10;bars=[];black=True
  for width in modules:
   if black:bars.append(f'<rect x="{x:.2f}" y="1" width="{width*scale:.2f}" height="{height*3.1:.2f}"/>')
   x+=width*scale;black=not black
  return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {x+10:.2f} {height*3.1+2:.2f}" preserveAspectRatio="none">{"".join(bars)}</svg>'
 def setting(name,fallback):
  if payload.get(name) is not None:return int(payload[name])
  try:return int(settings[name])
  except (KeyError,IndexError):return fallback
 fmt=clean(payload.get('format')) or settings['format'];cols=2 if fmt=='small' else 1;width=setting('width_mm',58);height=setting('height_mm',38);margin=setting('margin_mm',2);name_size=setting('name_size',13);price_size=setting('price_size',24);bar_height=setting('barcode_height',10);gap=setting('gap_mm',2);row_gap=setting('row_gap_mm',0);page_margin=setting('page_margin_mm',0);barcode_gap=setting('barcode_gap_mm',2);require(width-gap*(cols-1)>=20,'El ancho y la separación no dejan espacio para las etiquetas')
 def label_price(value):return f"{(int(value)+50)//100:,}".replace(',', '.')
 cards=''.join(f"<article><div class='name'>{html.escape(p['name'])}</div><div class='price'>$ {label_price(p['price'])}</div><div class='barcode'>{barcode(clean(p['barcode'] or p['sku']),bar_height)}</div><div class='barcode-value'>{html.escape(clean(p['barcode'] or p['sku']))}</div></article>" for p in items)
 return f'''<!doctype html><html lang="es"><meta charset="utf-8"><title>Etiquetas</title><style>@page{{size:{width}mm auto;margin:{page_margin}mm}}*{{box-sizing:border-box}}html,body{{margin:0;padding:0}}body{{width:{width}mm;font-family:Arial;color:#000}}.toolbar{{padding:4px;text-align:center}}main{{width:{width}mm;display:grid;grid-template-columns:repeat({cols},minmax(0,1fr));column-gap:{gap}mm;row-gap:{row_gap}mm;align-items:start}}article{{width:100%;height:{height}mm;border:1px dashed #888;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1mm;text-align:center;padding:{margin}mm;overflow:hidden;break-inside:avoid}}.name{{width:100%;font-size:{name_size}px;font-weight:800;line-height:1.08;max-height:3.3em;overflow:hidden;text-transform:uppercase}}.barcode-value{{font-size:8px;line-height:1;max-width:100%;overflow-wrap:anywhere;letter-spacing:.25px}}.price{{width:100%;font-size:{price_size}px;font-weight:900;line-height:1;margin:0;white-space:nowrap}}.barcode{{width:94%;height:{bar_height}mm;line-height:0;margin-top:{barcode_gap}mm}}.barcode svg{{display:block;width:100%;height:100%}}@media print{{.toolbar{{display:none}}}}</style><div class="toolbar"><button onclick="print()">Imprimir todas las etiquetas</button></div><main data-columns="{cols}" data-width-mm="{width}" data-page-margin-mm="{page_margin}">{cards}</main></html>'''
