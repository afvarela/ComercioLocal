"""Comercio Local: local-only POS, Python 3.11+, no external dependencies."""
from __future__ import annotations
import argparse, csv, hashlib, hmac, html, io, json, os, re, secrets, smtplib, sqlite3, ssl, textwrap, time
from datetime import datetime, date, timedelta
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from email.message import EmailMessage
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from contextlib import closing
from excel_report import inventory_xlsx, report_xlsx
from finance import finance_state, finance_command
from dairy import dairy_state, dairy_command
from logistics import logistics_state, logistics_command, sale_options, dispatch_receipt, labels_html
from receipt_layout import product_receipt_lines,pos_product_receipt_lines
from invoice_document import invoice_html, invoice_pdf

try:
    from reportlab.lib.pagesizes import letter
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table as PdfTable, TableStyle
    from reportlab.lib import colors
except ImportError:
    letter=getSampleStyleSheet=mm=SimpleDocTemplate=Paragraph=Spacer=PdfTable=TableStyle=colors=None

ROOT=Path(__file__).resolve().parent
METHODS=['Efectivo','Nequi','Daviplata','Bancolombia','Datáfono']
def load_env():
    file=ROOT/'.env'
    if file.exists():
        for line in file.read_text('utf-8').splitlines():
            line=line.strip()
            if line and not line.startswith('#') and '=' in line:
                key,value=line.split('=',1); os.environ.setdefault(key.strip(),value.strip().strip('"').strip("'"))
load_env()
def now(): return datetime.now().astimezone().isoformat(timespec='seconds')
def today(): return date.today().isoformat()
def require(ok,msg):
    if not ok: raise ValueError(msg)
def money(v):
    try:
        d=Decimal(str(v)); require(d.is_finite() and d>=0 and d<=Decimal('100000000000'), 'Valor monetario inválido')
        return int((d*100).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
    except InvalidOperation: raise ValueError('Valor monetario inválido')
def quantity(v,unit):
    try:
        d=Decimal(str(v)); factor=1000 if unit=='m' else 1
        require(d.is_finite() and d>=0 and d<=1000000000,'Cantidad inválida')
        require(d*factor==(d*factor).to_integral_value(),'Use gramos o unidades enteras; metros con máximo tres decimales')
        return int(d*factor)
    except InvalidOperation: raise ValueError('Cantidad inválida')
def amount(q,p,u,basis=1000): return int((Decimal(q)*p/(basis if u=='g' else 1000 if u=='m' else 1)).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
def iso(v,optional=False):
    if optional and not v: return None
    try: return date.fromisoformat(str(v)).isoformat()
    except ValueError: raise ValueError('Fecha inválida')
def clean(v,n=200): return str(v or '').strip()[:n]
def simple_pdf(lines):
    """Dependency-free letter PDF fallback for Windows/offline installations."""
    safe=[]
    for line in lines:
        text=str(line).encode('latin-1','replace').decode('latin-1').replace('\\','\\\\').replace('(','\\(').replace(')','\\)')
        safe.append(text)
    pages=[safe[i:i+45] for i in range(0,len(safe),45)] or [[]]; objects=[]
    objects.append(b'<< /Type /Catalog /Pages 2 0 R >>'); kids=' '.join(f'{3+i*2} 0 R' for i in range(len(pages)))
    objects.append(f'<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>'.encode())
    font_id=3+len(pages)*2
    for index,page in enumerate(pages):
        page_id=3+index*2; content_id=page_id+1
        objects.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 {font_id} 0 R >> >> /Contents {content_id} 0 R >>'.encode())
        commands=['BT /F1 10 Tf 50 750 Td 14 TL']+[f'({x}) Tj T*' for x in page]+['ET']; stream='\n'.join(commands).encode('latin-1')
        objects.append(b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream')
    objects.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    out=bytearray(b'%PDF-1.4\n'); offsets=[0]
    for i,obj in enumerate(objects,1): offsets.append(len(out)); out.extend(f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n')
    xref=len(out); out.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode())
    for offset in offsets[1:]: out.extend(f'{offset:010d} 00000 n \n'.encode())
    out.extend(f'trailer << /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode()); return bytes(out)
def _password_derive(p,salt):
    return salt+':'+hashlib.pbkdf2_hmac('sha256',p.encode(),salt.encode(),300000).hex()
def password_hash(p,salt=None):
    require(bool(re.fullmatch(r'\d{4}',p)),'El PIN debe tener exactamente 4 numeros')
    return _password_derive(p,salt or secrets.token_hex(16))
def password_check(p,stored):
    try: return hmac.compare_digest(_password_derive(p,stored.split(':',1)[0]),stored)
    except (ValueError, AttributeError): return False

class ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try: return super().__exit__(exc_type, exc_value, traceback)
        finally: self.close()

class Store:
    def __init__(self,path,seed_catalog=True):
        self.path=Path(path); self.path.parent.mkdir(parents=True,exist_ok=True)
        with self.connect() as db:
            db.executescript((ROOT/'schema.sql').read_text('utf-8'))
            db.execute('PRAGMA journal_mode=WAL')
            # Additive migrations preserve all existing prices, quantities and sales.
            for table,column,definition in [('products','price_basis','INTEGER NOT NULL DEFAULT 1000'),('products','image','TEXT NOT NULL DEFAULT \'\''),('lots','cost_basis','INTEGER NOT NULL DEFAULT 1000'),('sale_lines','price_basis','INTEGER NOT NULL DEFAULT 1000')]:
                if column not in [r['name'] for r in db.execute(f'PRAGMA table_info({table})')]:
                    db.execute(f'ALTER TABLE {table} ADD COLUMN {column} {definition}')
            for table,column,definition in [
                ('products','current_cost','INTEGER NOT NULL DEFAULT 0'),
                ('lots','original_qty','INTEGER NOT NULL DEFAULT 0'),
                ('lots','purchase_id','INTEGER'),
                ('lots','status',"TEXT NOT NULL DEFAULT 'Activa'"),
                ('stock_moves','cost','INTEGER NOT NULL DEFAULT 0'),
                ('stock_moves','cost_basis','INTEGER NOT NULL DEFAULT 1000'),
                ('stock_moves','balance_after','INTEGER NOT NULL DEFAULT 0'),
                ('stock_moves','note',"TEXT NOT NULL DEFAULT ''"),
                ('businesses','email',"TEXT NOT NULL DEFAULT ''"),
                ('products','max_stock','INTEGER NOT NULL DEFAULT 0'),
                ('products','reorder_point','INTEGER NOT NULL DEFAULT 0'),
                ('products','lead_time_days','INTEGER NOT NULL DEFAULT 3'),
                ('cash_sessions','difference','INTEGER NOT NULL DEFAULT 0'),
                ('cash_sessions','difference_type',"TEXT NOT NULL DEFAULT ''"),
                ('cash_sessions','difference_reason',"TEXT NOT NULL DEFAULT ''"),
                ('cash_sessions','difference_note',"TEXT NOT NULL DEFAULT ''"),
                ('cash_sessions','closed_by','INTEGER'),
                ('sales','dairy_total','INTEGER NOT NULL DEFAULT 0'),
                ('sales','cash_received','INTEGER NOT NULL DEFAULT 0'),
                ('sales','change_given','INTEGER NOT NULL DEFAULT 0'),
            ]:
                if column not in [r['name'] for r in db.execute(f'PRAGMA table_info({table})')]:
                    db.execute(f'ALTER TABLE {table} ADD COLUMN {column} {definition}')
            for column,definition,source in [('can_create','INTEGER NOT NULL DEFAULT 0','can_write'),('can_export','INTEGER NOT NULL DEFAULT 0','can_report')]:
                if column not in [r['name'] for r in db.execute('PRAGMA table_info(finance_permissions)')]:
                    db.execute(f'ALTER TABLE finance_permissions ADD COLUMN {column} {definition}')
                    db.execute(f'UPDATE finance_permissions SET {column}={source}')
            db.execute("UPDATE finance_accounts SET active=0 WHERE type='petty_cash'")
            # Existing lot costs remain the source of truth; initialize the
            # displayed moving average without rewriting historical sales.
            db.execute("UPDATE lots SET original_qty=qty WHERE original_qty=0 AND qty>0")
            db.execute("""UPDATE products SET current_cost=COALESCE((
                SELECT CAST(ROUND(SUM(l.qty*l.cost*1.0/CASE WHEN products.unit='g' THEN l.cost_basis WHEN products.unit='m' THEN 1000 ELSE 1 END)*
                  CASE WHEN products.unit='g' THEN products.price_basis WHEN products.unit='m' THEN 1000 ELSE 1 END/SUM(l.qty)) AS INTEGER)
                FROM lots l WHERE l.product_id=products.id AND l.qty>0),0)
                WHERE current_cost=0""")
            db.execute("""INSERT OR IGNORE INTO receivables(business_id,customer_id,sale_id,created,original_amount,paid_amount,returned_amount,balance,status)
                SELECT business_id,customer_id,id,created,original_debt,original_debt-debt,0,debt,
                  CASE WHEN status='void' THEN 'Anulado' WHEN debt=0 THEN 'Pagado' WHEN debt<original_debt THEN 'Parcialmente pagado' ELSE 'Pendiente' END
                FROM sales WHERE customer_id IS NOT NULL AND original_debt>0""")
            db.execute("""INSERT OR IGNORE INTO receivable_moves(receivable_id,business_id,customer_id,sale_id,created,kind,amount,balance_after,user_id,note,request_id)
                SELECT r.id,r.business_id,r.customer_id,r.sale_id,r.created,'Saldo migrado',r.original_amount,r.balance,s.user_id,'Cuenta por cobrar incorporada a la trazabilidad','migracion-' || r.sale_id
                FROM receivables r JOIN sales s ON s.id=r.sale_id
                WHERE NOT EXISTS(SELECT 1 FROM receivable_moves m WHERE m.receivable_id=r.id)""")
            if seed_catalog:
                catalog=ROOT/'vegetables.json'
                if catalog.exists():
                    for p in json.loads(catalog.read_text('utf-8')):
                        unit=p.get('unit','g'); basis=int(p.get('price_basis',500 if unit=='g' else 1))
                        description='Venta por peso · libra de 500 g' if unit=='g' and basis==500 else 'Venta por unidad / manojo' if unit=='und' else 'Producto de minimercado'
                        db.execute("INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,price_basis,image) VALUES(1,?,?,?,'Verduras',?,0,0,1,?,?)",(p['sku'],p['name'],description,unit,basis,p.get('image','')))
    def connect(self):
        db=sqlite3.connect(self.path,timeout=15,factory=ClosingConnection); db.row_factory=sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON'); return db
    def rows(self,db,sql,args=()): return [dict(x) for x in db.execute(sql,args)]
    def one(self,db,sql,args=()):
        r=db.execute(sql,args).fetchone(); return dict(r) if r else None
    def scoped(self,db,table,id,b):
        require(table in ('products','lots','customers','sales','quotes','cash_sessions'),'Tabla inválida')
        r=self.one(db,f'SELECT * FROM {table} WHERE id=? AND business_id=?',(id,b)); require(r,'Registro no encontrado en este negocio'); return r
    def audit(self,db,u,b,action,detail): db.execute('INSERT INTO audit(business_id,user_id,created,action,detail) VALUES(?,?,?,?,?)',(b,u['id'],now(),action,json.dumps(detail,ensure_ascii=False)))
    def admin(self,u): require(u['role']=='admin','Esta operación requiere administrador')
    def cash(self,db,b):
        c=self.one(db,'SELECT * FROM cash_sessions WHERE business_id=? AND closed IS NULL',(b,)); require(c,'Abra la caja de este negocio antes de continuar'); return c
    def expected(self,db,c):
        return c['opening']+db.execute("SELECT COALESCE(SUM(amount),0) FROM payments WHERE cash_id=? AND method='Efectivo'",(c['id'],)).fetchone()[0]+db.execute('SELECT COALESCE(SUM(amount),0) FROM cash_moves WHERE cash_id=?',(c['id'],)).fetchone()[0]
    def update_average(self,db,p):
        lots=self.rows(db,'SELECT qty,cost,cost_basis FROM lots WHERE product_id=? AND qty>0',(p['id'],)); total_qty=sum(x['qty'] for x in lots)
        if not total_qty: average=0
        else:
            total=sum(amount(x['qty'],x['cost'],p['unit'],x['cost_basis']) for x in lots); divisor=p['price_basis'] if p['unit']=='g' else 1000 if p['unit']=='m' else 1
            average=int((Decimal(total)*divisor/Decimal(total_qty)).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
        db.execute('UPDATE products SET current_cost=? WHERE id=?',(average,p['id'])); return average
    def setup(self,data):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE'); require(not db.execute('SELECT 1 FROM users WHERE active=1').fetchone(),'El administrador ya está configurado')
            name=clean(data.get('name')); username=clean(data.get('username')).lower()
            require(name and username,'Complete nombre y usuario')
            user_id=db.execute("INSERT INTO users(username,name,password,role) VALUES(?,?,?,'admin')",(username,name,password_hash(str(data.get('password',''))))).lastrowid
            db.execute('INSERT OR REPLACE INTO dairy_permissions(user_id,can_view,can_price,can_void,can_close,can_reopen) VALUES(?,1,1,1,1,1)',(user_id,))
            for business_id in (1,2): db.execute('INSERT OR REPLACE INTO finance_permissions(user_id,business_id,can_view,can_write,can_create,can_edit,can_authorize,can_report,can_export,can_configure,can_void) VALUES(?,?,1,1,1,1,1,1,1,1,1)',(user_id,business_id))
        return {'ok':True}
    def login(self,data):
        with self.connect() as db:
            u=self.one(db,'SELECT * FROM users WHERE username=? AND active=1',(clean(data.get('username')).lower(),))
            require(u and password_check(str(data.get('password','')),u['password']),'Usuario o contraseña incorrectos')
            token=secrets.token_urlsafe(32); db.execute('DELETE FROM sessions WHERE expires<?',(int(time.time()),))
            db.execute('INSERT INTO sessions VALUES(?,?,?)',(token,u['id'],int(time.time())+43200))
            return token
    def user(self,token):
        with self.connect() as db:
            return self.one(db,'SELECT u.id,u.username,u.name,u.role,u.businesses FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1',(token,int(time.time())))
    def state(self,u,b):
        with self.connect() as db:
            products=self.rows(db,"""SELECT p.*, COALESCE((SELECT SUM(qty) FROM lots WHERE product_id=p.id),0) stock,
              COALESCE((SELECT SUM(qty) FROM lots WHERE product_id=p.id AND (expires IS NULL OR expires>=?)),0) available
              FROM products p WHERE p.business_id=? AND p.active=1 ORDER BY p.name""",(today(),b))
            lots=self.rows(db,'SELECT l.*,p.name,p.unit FROM lots l JOIN products p ON p.id=l.product_id WHERE l.business_id=? AND l.qty>0 ORDER BY COALESCE(l.expires,\'9999\'),l.id',(b,))
            if u['role']!='admin':
                for l in lots: l.pop('cost',None)
            c=self.one(db,'SELECT c.*,u.name operator FROM cash_sessions c JOIN users u ON u.id=c.user_id WHERE c.business_id=? AND c.closed IS NULL',(b,))
            if c: c['expected']=self.expected(db,c)
            return {'user':u,'businesses':self.rows(db,'SELECT * FROM businesses WHERE id IN (%s)' % ','.join('?' for _ in json.loads(u['businesses'])),json.loads(u['businesses'])), 'products':products,'lots':lots,'customers':self.rows(db,'SELECT c.*,COALESCE((SELECT SUM(debt) FROM sales WHERE customer_id=c.id AND status=\'active\'),0) balance,COALESCE((SELECT SUM(total) FROM sales WHERE customer_id=c.id AND status=\'active\'),0) total_purchases,COALESCE((SELECT COUNT(*) FROM sales WHERE customer_id=c.id AND status=\'active\'),0) purchase_count FROM customers c WHERE business_id=? ORDER BY name',(b,)),'cash':c,'finance_access':self.one(db,'SELECT * FROM finance_permissions WHERE user_id=? AND business_id=?',(u['id'],b)),'dairy_products':self.rows(db,'SELECT * FROM dairy_products WHERE active=1 ORDER BY id') if b==1 else [],'dairy_access':self.one(db,'SELECT * FROM dairy_permissions WHERE user_id=?',(u['id'],)) if b==1 else None,'smtp_configured':bool(os.getenv('POS_SMTP_HOST'))}
    def lines(self,db,b,raw,stock=True):
        require(isinstance(raw,list) and 0<len(raw)<=300,'Agregue productos a la venta')
        combined={}
        for item in raw:
            p=self.scoped(db,'products',int(item['product_id']),b); require(p['active'],'Producto inactivo')
            q=quantity(item['qty'],p['unit']); require(q>0,'La cantidad debe ser mayor que cero')
            if p['id'] in combined: combined[p['id']]['qty']+=q
            else: combined[p['id']]={**p,'product_id':p['id'],'qty':q}
        result=[]
        for p in combined.values():
            p['total']=amount(p['qty'],p['price'],p['unit'],p['price_basis']); require(p['total']>0,'El total de cada producto debe ser mayor que cero')
            p['cost']=0; p['allocations']=[]
            if stock:
                remaining=p['qty']
                for lot in self.rows(db,"SELECT * FROM lots WHERE business_id=? AND product_id=? AND qty>0 AND (expires IS NULL OR expires>=?) ORDER BY CASE WHEN code LIKE 'INICIAL-%' THEN 0 ELSE 1 END, CASE WHEN expires IS NULL THEN 1 ELSE 0 END, expires,id",(b,p['id'],today())):
                    take=min(remaining,lot['qty'])
                    if take:
                        p['allocations'].append({'lot_id':lot['id'],'qty':take}); p['cost']+=amount(take,lot['cost'],p['unit'],lot['cost_basis']); remaining-=take
                    if not remaining: break
                require(not remaining,'Existencias insuficientes o vencidas: '+p['name'])
            result.append(p)
        return result
    def command(self,u,b,action,d):
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            result={ 'ok':True }
            if action=='product':
                self.admin(u); name=clean(d.get('name')); sku=clean(d.get('sku')); unit=d.get('unit')
                require(name and sku and unit in ('und','g','m'),'Nombre, referencia y unidad son obligatorios')
                vals=(sku,clean(d.get('barcode')) or None,name,clean(d.get('description'),1000),clean(d.get('category')),unit,money(d['price']),quantity(d.get('min_stock',0),unit),int(bool(d.get('perishable'))))
                basis=int(d.get('price_basis',1000)); require(basis in (500,1000),'Base de precio inválida')
                if d.get('id'):
                    old=self.scoped(db,'products',d['id'],b); require(old['unit']==unit,'No se puede cambiar la unidad de un producto existente')
                    db.execute('UPDATE products SET sku=?,barcode=?,name=?,description=?,category=?,unit=?,price=?,min_stock=?,perishable=? WHERE id=? AND business_id=?',(*vals,d['id'],b))
                    db.execute('UPDATE products SET price_basis=? WHERE id=? AND business_id=?',(basis,d['id'],b))
                else: result['id']=db.execute('INSERT INTO products(business_id,sku,barcode,name,description,category,unit,price,min_stock,perishable) VALUES(?,?,?,?,?,?,?,?,?,?)',(b,*vals)).lastrowid
                if not d.get('id'): db.execute('UPDATE products SET price_basis=? WHERE id=?',(basis,result['id']))
                pid=int(d.get('id') or result['id']); max_stock=quantity(d.get('max_stock',0),unit); reorder=quantity(d.get('reorder_point',0),unit); lead=int(d.get('lead_time_days',3) or 0)
                require(max_stock>=0 and reorder>=0 and 0<=lead<=365,'Revise los parámetros de reposición')
                db.execute('UPDATE products SET max_stock=?,reorder_point=?,lead_time_days=? WHERE id=? AND business_id=?',(max_stock,reorder,lead,pid,b))
            elif action=='initial_stock':
                self.admin(u); require(b==1,'La carga rápida de existencia inicial solo está disponible en mini market')
                p=self.scoped(db,'products',d['product_id'],b); q=quantity(d['qty'],p['unit']); require(q>0,'Ingrese cantidad positiva')
                unit_cost=money(d.get('cost',0)); old_qty=db.execute('SELECT COALESCE(SUM(qty),0) FROM lots WHERE product_id=?',(p['id'],)).fetchone()[0]
                old_total=amount(old_qty,p['current_cost'],p['unit'],p['price_basis']); new_total=amount(q,unit_cost,p['unit'],p['price_basis'])
                divisor=p['price_basis'] if p['unit']=='g' else 1000 if p['unit']=='m' else 1
                average=int((Decimal(old_total+new_total)*divisor/Decimal(old_qty+q)).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
                created=now(); code='INICIAL-'+created.replace('-','').replace(':','').replace('.','')[:15]+'-'+str(p['id'])
                lid=db.execute('INSERT INTO lots(business_id,product_id,code,expires,qty,cost,supplier,reference,created,cost_basis,original_qty,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(b,p['id'],code,None,q,unit_cost,'Inventario inicial','Carga rápida',created,p['price_basis'],q,'Activo')).lastrowid
                db.execute('UPDATE products SET current_cost=? WHERE id=?',(average,p['id']))
                db.execute('INSERT INTO stock_moves(business_id,product_id,lot_id,user_id,created,qty,kind,reference,cost,cost_basis,balance_after,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(b,p['id'],lid,u['id'],created,q,'Inventario inicial',code,unit_cost,p['price_basis'],old_qty+q,clean(d.get('note'),1000)))
                result.update(id=lid)
            elif action=='receive':
                self.admin(u); p=self.scoped(db,'products',d['product_id'],b); q=quantity(d['qty'],p['unit']); require(q>0,'Ingrese cantidad positiva')
                created=now(); code=clean(d.get('code')) or f"AUTO-{created.replace('-','').replace(':','').replace('.','')[:15]}-{p['id']}"
                expiry=iso(d.get('expires'),True); supplier=clean(d.get('supplier')) or 'Sin proveedor'
                require(not expiry or expiry>=today(),'No se permite recibir mercancia vencida')
                sale_price=money(d.get('sale_price')) if clean(d.get('sale_price')) else None
                if sale_price is not None: require(sale_price>0,'El precio de venta debe ser mayor que cero')
                unit_cost=money(d['cost']); old_qty=db.execute('SELECT COALESCE(SUM(qty),0) FROM lots WHERE product_id=?',(p['id'],)).fetchone()[0]
                old_total=amount(old_qty,p['current_cost'],p['unit'],p['price_basis']); new_total=amount(q,unit_cost,p['unit'],p['price_basis'])
                divisor=p['price_basis'] if p['unit']=='g' else 1000 if p['unit']=='m' else 1
                average=int((Decimal(old_total+new_total)*divisor/Decimal(old_qty+q)).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
                purchase_number=db.execute('SELECT COALESCE(MAX(number),0)+1 FROM purchases WHERE business_id=?',(b,)).fetchone()[0]
                request_id=clean(d.get('request_id')) or secrets.token_urlsafe(18)
                purchase_id=db.execute("INSERT INTO purchases(business_id,number,supplier,reference,created,user_id,total,status,note,request_id) VALUES(?,?,?,?,?,?,?,?,?,?)",(b,purchase_number,supplier,clean(d.get('reference')),now(),u['id'],new_total,'Activa',clean(d.get('note'),1000),request_id)).lastrowid
                lid=db.execute('INSERT INTO lots(business_id,product_id,code,expires,qty,cost,supplier,reference,created,cost_basis,original_qty,purchase_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(b,p['id'],code,expiry,q,unit_cost,supplier,clean(d.get('reference')),now(),p['price_basis'],q,purchase_id)).lastrowid
                db.execute('INSERT INTO purchase_lines(purchase_id,product_id,lot_id,qty,cost,cost_basis,total) VALUES(?,?,?,?,?,?,?)',(purchase_id,p['id'],lid,q,unit_cost,p['price_basis'],new_total))
                db.execute('UPDATE products SET current_cost=?,price=COALESCE(?,price) WHERE id=?',(average,sale_price,p['id']))
                db.execute('INSERT INTO stock_moves(business_id,product_id,lot_id,user_id,created,qty,kind,reference,cost,cost_basis,balance_after,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(b,p['id'],lid,u['id'],now(),q,'Compra',f'COMP-{purchase_number:06d}',unit_cost,p['price_basis'],old_qty+q,clean(d.get('note'),1000))); result.update(id=lid,purchase_id=purchase_id)
            elif action=='waste':
                self.admin(u); lot=self.scoped(db,'lots',d['lot_id'],b); p=self.scoped(db,'products',lot['product_id'],b); q=quantity(d['qty'],p['unit']); reason=clean(d.get('reason'))
                require(0<q<=lot['qty'] and reason,'Revise la cantidad y escriba el motivo de la salida')
                db.execute('UPDATE lots SET qty=qty-? WHERE id=?',(q,lot['id']))
                balance=db.execute('SELECT COALESCE(SUM(qty),0) FROM lots WHERE product_id=?',(p['id'],)).fetchone()[0]
                db.execute('INSERT INTO stock_moves(business_id,product_id,lot_id,user_id,created,qty,kind,reference,cost,cost_basis,balance_after,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(b,p['id'],lot['id'],u['id'],now(),-q,'Ajuste negativo',reason,lot['cost'],lot['cost_basis'],balance,reason))
            elif action=='customer':
                require(clean(d.get('name')),'Indique el nombre del cliente'); email=clean(d.get('email')); require(not email or re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email),'Correo inválido')
                if u['role']!='admin': require(money(d.get('credit_limit',0))==0,'Solo el administrador asigna cupos de crédito')
                vals=(clean(d['name']),clean(d.get('document')),clean(d.get('phone')),email,money(d.get('credit_limit',0)))
                if d.get('id'):
                    self.admin(u); self.scoped(db,'customers',d['id'],b); db.execute('UPDATE customers SET name=?,document=?,phone=?,email=?,credit_limit=? WHERE id=? AND business_id=?',(*vals,d['id'],b))
                else: result['id']=db.execute('INSERT INTO customers(business_id,name,document,phone,email,credit_limit) VALUES(?,?,?,?,?,?)',(b,*vals)).lastrowid
            elif action=='open_cash':
                require(not db.execute('SELECT 1 FROM cash_sessions WHERE business_id=? AND closed IS NULL',(b,)).fetchone(),'Ya hay una caja abierta')
                result['id']=db.execute('INSERT INTO cash_sessions(business_id,user_id,opened,opening,note) VALUES(?,?,?,?,?)',(b,u['id'],now(),money(d['opening']),clean(d.get('note'),1000))).lastrowid; result['receipt']='cash'
            elif action=='cash_move':
                c=self.cash(db,b); value=money(d['amount']); require(value>0 and clean(d.get('reason')),'Indique valor y motivo')
                require(d.get('direction') in ('in','out'),'Tipo de movimiento inválido')
                value*= -1 if d['direction']=='out' else 1; require(self.expected(db,c)+value>=0,'El retiro supera el efectivo esperado')
                result['id']=db.execute('INSERT INTO cash_moves(business_id,cash_id,user_id,created,amount,reason) VALUES(?,?,?,?,?,?)',(b,c['id'],u['id'],now(),value,clean(d['reason']))).lastrowid
            elif action=='close_cash':
                c=self.cash(db,b); require(u['role']=='admin' or c['user_id']==u['id'],'Solo quien abrió la caja o el administrador puede cerrarla')
                counted=money(d['counted']); expected=self.expected(db,c); difference=counted-expected
                reason=clean(d.get('difference_reason')); note=clean(d.get('difference_note'),1000)
                if difference:
                    require(reason in ('Error de conteo','Gasto no registrado','Ingreso no registrado','Dinero entregado o retirado','Otro'),'Seleccione el motivo de la diferencia')
                    require(reason!='Otro' or note,'Describa el motivo cuando selecciona Otro')
                dtype='Sobrante' if difference>0 else 'Faltante' if difference<0 else 'Exacta'
                db.execute('UPDATE cash_sessions SET closed=?,counted=?,expected=?,difference=?,difference_type=?,difference_reason=?,difference_note=?,closed_by=?,note=note || ? WHERE id=?',(now(),counted,expected,difference,dtype,reason,note,u['id'],'\nCierre: '+clean(d.get('note'),1000),c['id']))
                result.update(id=c['id'],receipt='cash',difference=difference,difference_type=dtype)
            elif action=='customer_payment':
                c=self.cash(db,b); cid=int(d.get('customer_id') or 0); self.scoped(db,'customers',cid,b)
                method=d.get('method'); require(method in METHODS,'Medio de pago inválido')
                value=money(d.get('amount')); require(value>0,'Ingrese un valor mayor que cero')
                pending=self.rows(db,"SELECT * FROM receivables WHERE business_id=? AND customer_id=? AND balance>0 AND status!='Anulado' ORDER BY created,id",(b,cid))
                require(pending,'El cliente no tiene cuentas pendientes'); require(value<=sum(x['balance'] for x in pending),'El abono supera el saldo total del cliente')
                request=clean(d.get('request_id')) or secrets.token_urlsafe(18)
                existing=self.one(db,'SELECT id FROM collections WHERE request_id=?',(request,))
                if existing: return {'ok':True,'id':existing['id'],'receipt':'collection'}
                collection=db.execute('INSERT INTO collections(business_id,customer_id,cash_id,user_id,created,amount,method,reference,request_id) VALUES(?,?,?,?,?,?,?,?,?)',(b,cid,c['id'],u['id'],now(),value,method,clean(d.get('reference')),request)).lastrowid
                payment=db.execute("INSERT INTO payments(business_id,cash_id,user_id,created,method,amount,kind,reference) VALUES(?,?,?,?,?,?,'Abono',?)",(b,c['id'],u['id'],now(),method,value,clean(d.get('reference')))).lastrowid
                remaining=value; applied_count=0
                for rec in pending:
                    applied=min(remaining,rec['balance']); new=rec['balance']-applied; status='Pagado' if new==0 else 'Parcialmente pagado'
                    db.execute('UPDATE receivables SET paid_amount=paid_amount+?,balance=?,status=? WHERE id=?',(applied,new,status,rec['id']))
                    db.execute('UPDATE sales SET debt=? WHERE id=?',(new,rec['sale_id']))
                    db.execute('INSERT INTO collection_allocations(collection_id,receivable_id,sale_id,amount,balance_after) VALUES(?,?,?,?,?)',(collection,rec['id'],rec['sale_id'],applied,new))
                    db.execute('INSERT INTO receivable_moves(receivable_id,business_id,customer_id,sale_id,payment_id,created,kind,amount,balance_after,user_id,note,request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(rec['id'],b,cid,rec['sale_id'],payment,now(),'Abono automático',-applied,new,u['id'],clean(d.get('reference')),f'{request}:{rec["id"]}'))
                    remaining-=applied; applied_count+=1
                    if not remaining: break
                result.update(id=collection,receipt='collection',allocations=applied_count)
            elif action=='quote':
                require(b==2,'Las cotizaciones están disponibles en ferretería'); raw=d.get('lines') or []; lines=self.lines(db,b,raw,False) if raw else []
                for item in d.get('unregistered_lines') or []:
                    q=quantity(item.get('qty',1),'und'); price=money(item.get('price')); require(q>0 and price>0,'Revise el producto no registrado de la cotización')
                    lines.append({'product_id':None,'unregistered':True,'name':'Producto no registrado','description':'Concepto sin control de inventario','sku':'NO-CATALOGADO','unit':'und','qty':q,'price':price,'price_basis':1,'total':q*price,'cost':0,'allocations':[]})
                require(lines,'Agregue productos a la cotización'); cid=d.get('customer_id') or None
                if cid: self.scoped(db,'customers',cid,b)
                valid=iso(d.get('valid_until')); require(valid>=today(),'La vigencia no puede estar en el pasado')
                result['id']=db.execute('INSERT INTO quotes(business_id,customer_id,user_id,created,valid_until,lines,total,note) VALUES(?,?,?,?,?,?,?,?)',(b,cid,u['id'],now(),valid,json.dumps(lines),sum(l['total'] for l in lines),clean(d.get('note'),1000))).lastrowid; result['receipt']='quote'
            elif action=='sale':
                request=clean(d.get('request_id')); require(len(request)>=16,'Identificador de venta inválido')
                old=self.one(db,'SELECT id FROM sales WHERE business_id=? AND request_id=?',(b,request))
                if old: return {**old,'receipt':'sale','ok':True}
                c=self.cash(db,b); raw_lines=d.get('lines') or []; extras=d.get('unregistered_lines') or []; dairy_raw=d.get('dairy_lines') or []
                require(raw_lines or extras or dairy_raw,'Agregue productos a la venta'); lines=self.lines(db,b,raw_lines) if raw_lines else []
                dairy=[]
                if dairy_raw:
                    require(b==1 and not db.execute("SELECT 1 FROM dairy_closures WHERE day=? AND status='closed'",(today(),)).fetchone(),'El recaudo de lácteos de hoy ya está cerrado')
                    for item in dairy_raw:
                        product=self.one(db,'SELECT * FROM dairy_products WHERE id=? AND active=1',(int(item['product_id']),)); q=round(float(item['qty'])*1000)
                        require(product and product['price']>0 and q>0,'Revise el lácteo, su precio y cantidad')
                        dairy.append({**product,'qty':q,'total':round(q*product['price']/1000)})
                require(isinstance(extras,list) and len(extras)<=50,'Productos no registrados inválidos'); clean_extras=[]
                for item in extras:
                    description=clean(item.get('description')); q=quantity(item.get('qty',1),'und'); price=money(item.get('price')); discount=money(item.get('discount',0))
                    require(description and q>0 and price>0 and discount<=price*q,'Revise el producto no registrado')
                    clean_extras.append({'description':description,'qty':q,'unit':'und','price':price,'discount':discount,'total':price*q-discount})
                total=sum(l['total'] for l in lines)+sum(x['total'] for x in clean_extras); dairy_total=sum(x['total'] for x in dairy); grand_total=total+dairy_total; cost=sum(l['cost'] for l in lines)
                quote_id=d.get('quote_id') or None
                if quote_id:
                    quote=self.scoped(db,'quotes',quote_id,b); require(not quote['converted_sale'],'La cotización ya fue convertida'); require(quote['valid_until']>=today(),'La cotización está vencida; genere una nueva')
                cid=d.get('customer_id') or None; customer=self.scoped(db,'customers',cid,b) if cid else None
                payments=d.get('payments',[]); require(isinstance(payments,list) and len(payments)<=20,'Medios de pago inválidos')
                parts=[]
                for p in payments:
                    require(p['method'] in METHODS,'Medio de pago inválido'); val=money(p['amount'])
                    if val: parts.append((p['method'],val,clean(p.get('reference'))))
                paid=sum(p[1] for p in parts); require(paid>=dairy_total,'Los lácteos deben quedar pagados completamente'); debt=max(0,total-max(0,paid-dairy_total)); change=max(0,paid-grand_total); cash=sum(p[1] for p in parts if p[0]=='Efectivo')
                require(change<=cash,'El excedente solo puede devolverse del efectivo recibido')
                if debt:
                    require(d.get('allow_credit') and customer,'Seleccione un cliente y autorice el saldo fiado')
                    current=db.execute("SELECT COALESCE(SUM(debt),0) FROM sales WHERE customer_id=? AND status='active'",(cid,)).fetchone()[0]
                    require(current+debt<=customer['credit_limit'],'El saldo excede el cupo de crédito del cliente')
                    due=iso(d.get('due')); require(due>=today(),'La fecha de pago no puede estar en el pasado')
                else: due=None
                number=db.execute('SELECT COALESCE(MAX(number),0)+1 FROM sales WHERE business_id=?',(b,)).fetchone()[0]
                sid=db.execute('INSERT INTO sales(business_id,number,user_id,cash_id,customer_id,created,total,dairy_total,cost,debt,original_debt,due,request_id,quote_id,cash_received,change_given) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(b,number,u['id'],c['id'],cid,now(),total,dairy_total,cost,debt,debt,due,request,quote_id,cash,change)).lastrowid
                if debt:
                    rid=db.execute("INSERT INTO receivables(business_id,customer_id,sale_id,created,original_amount,balance,status) VALUES(?,?,?,?,?,?,?)",(b,cid,sid,now(),debt,debt,'Pendiente')).lastrowid
                    db.execute("INSERT INTO receivable_moves(receivable_id,business_id,customer_id,sale_id,created,kind,amount,balance_after,user_id,note,request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)",(rid,b,cid,sid,now(),'Venta fiada',debt,debt,u['id'],'Cuenta por cobrar creada',request+':credito'))
                for l in lines:
                    db.execute('INSERT INTO sale_lines(sale_id,product_id,name,sku,unit,qty,price,total,cost,allocations,price_basis) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(sid,l['product_id'],l['name'],l['sku'],l['unit'],l['qty'],l['price'],l['total'],l['cost'],json.dumps(l['allocations']),l['price_basis']))
                    for a in l['allocations']:
                        db.execute('UPDATE lots SET qty=qty-? WHERE id=?',(a['qty'],a['lot_id']))
                        lot=self.one(db,'SELECT cost,cost_basis FROM lots WHERE id=?',(a['lot_id'],)); balance=db.execute('SELECT COALESCE(SUM(qty),0) FROM lots WHERE product_id=?',(l['product_id'],)).fetchone()[0]
                        db.execute('INSERT INTO stock_moves(business_id,product_id,lot_id,user_id,created,qty,kind,reference,cost,cost_basis,balance_after,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(b,l['product_id'],a['lot_id'],u['id'],now(),-a['qty'],'Venta',f'VTA-{number:06d}',lot['cost'],lot['cost_basis'],balance,''))
                for x in clean_extras:
                    db.execute('INSERT INTO unregistered_sale_lines(sale_id,description,qty,unit,price,discount,total) VALUES(?,?,?,?,?,?,?)',(sid,x['description'],x['qty'],x['unit'],x['price'],x['discount'],x['total']))
                sale_time=now()
                for x in dairy: db.execute('INSERT INTO dairy_sale_lines(sale_id,product_id,qty,price,total,created,user_id) VALUES(?,?,?,?,?,?,?)',(sid,x['id'],x['qty'],x['price'],x['total'],sale_time,u['id']))
                pending_change=change; dairy_remaining=dairy_total
                for method,val,ref in parts:
                    if method=='Efectivo': back=min(val,pending_change); val-=back; pending_change-=back
                    dairy_part=min(val,dairy_remaining)
                    if dairy_part: db.execute('INSERT INTO dairy_payments(sale_id,method,amount,created) VALUES(?,?,?,?)',(sid,method,dairy_part,sale_time)); dairy_remaining-=dairy_part; val-=dairy_part
                    if val: db.execute('INSERT INTO payments(business_id,sale_id,cash_id,user_id,created,method,amount,kind,reference) VALUES(?,?,?,?,?,?,?,?,?)',(b,sid,c['id'],u['id'],sale_time,method,val,'Venta',ref))
                if quote_id: db.execute('UPDATE quotes SET converted_sale=? WHERE id=?',(sid,quote_id))
                result.update(id=sid,receipt='sale',change=change)
            elif action=='repay':
                c=self.cash(db,b); sale=self.scoped(db,'sales',d['sale_id'],b); val=money(d['amount']); method=d['method']
                require(sale['status']=='active' and 0<val<=sale['debt'],'El abono debe ser positivo y no superar el saldo'); require(method in METHODS,'Medio inválido')
                result['id']=db.execute('INSERT INTO payments(business_id,sale_id,cash_id,user_id,created,method,amount,kind,reference) VALUES(?,?,?,?,?,?,?,?,?)',(b,sale['id'],c['id'],u['id'],now(),method,val,'Abono',clean(d.get('reference')))).lastrowid
                db.execute('UPDATE sales SET debt=debt-? WHERE id=?',(val,sale['id']))
                receivable=self.one(db,'SELECT * FROM receivables WHERE sale_id=?',(sale['id'],)); require(receivable,'La cuenta por cobrar no existe; contacte al administrador')
                balance=receivable['balance']-val
                status='Pagado' if balance==0 else 'Parcialmente pagado'
                db.execute('UPDATE receivables SET paid_amount=paid_amount+?,balance=?,status=? WHERE id=?',(val,balance,status,receivable['id']))
                db.execute('INSERT INTO receivable_moves(receivable_id,business_id,customer_id,sale_id,payment_id,created,kind,amount,balance_after,user_id,note,request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(receivable['id'],b,receivable['customer_id'],sale['id'],result['id'],now(),'Abono',-val,balance,u['id'],clean(d.get('reference')),clean(d.get('request_id')) or f'abono-{result["id"]}'))
                result['receipt']='payment'
            elif action=='void_sale':
                self.admin(u); s=self.scoped(db,'sales',d['sale_id'],b); c=self.cash(db,b)
                require(s['status']=='active' and s['cash_id']==c['id'],'Solo se puede anular una venta activa de la caja actual')
                require(not db.execute("SELECT 1 FROM payments WHERE sale_id=? AND kind='Abono'",(s['id'],)).fetchone(),'La venta tiene abonos; requiere conciliación antes de anular')
                require(clean(d.get('reason')),'Escriba el motivo de anulación')
                cash_return=db.execute("SELECT COALESCE(SUM(amount),0) FROM payments WHERE sale_id=? AND method='Efectivo'",(s['id'],)).fetchone()[0]
                require(self.expected(db,c)>=cash_return,'Efectivo insuficiente para la devolución')
                for l in self.rows(db,'SELECT * FROM sale_lines WHERE sale_id=?',(s['id'],)):
                    for a in json.loads(l['allocations']):
                        db.execute('UPDATE lots SET qty=qty+? WHERE id=?',(a['qty'],a['lot_id']))
                        lot=self.one(db,'SELECT cost,cost_basis FROM lots WHERE id=?',(a['lot_id'],)); balance=db.execute('SELECT COALESCE(SUM(qty),0) FROM lots WHERE product_id=?',(l['product_id'],)).fetchone()[0]
                        db.execute('INSERT INTO stock_moves(business_id,product_id,lot_id,user_id,created,qty,kind,reference,cost,cost_basis,balance_after,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(b,l['product_id'],a['lot_id'],u['id'],now(),a['qty'],'Anulación de venta',f'VTA-{s["number"]:06d}',lot['cost'],lot['cost_basis'],balance,clean(d['reason'])))
                for p in self.rows(db,'SELECT * FROM payments WHERE sale_id=?',(s['id'],)):
                    db.execute('INSERT INTO payments(business_id,sale_id,cash_id,user_id,created,method,amount,kind,reference) VALUES(?,?,?,?,?,?,?,?,?)',(b,s['id'],c['id'],u['id'],now(),p['method'],-p['amount'],'Anulación',clean(d['reason'])))
                db.execute("UPDATE sales SET status='void',debt=0,void_reason=? WHERE id=?",(clean(d['reason']),s['id'])); db.execute("UPDATE dairy_sale_lines SET status='void' WHERE sale_id=?",(s['id'],))
                receivable=self.one(db,'SELECT * FROM receivables WHERE sale_id=?',(s['id'],))
                if receivable:
                    db.execute("UPDATE receivables SET balance=0,status='Anulado' WHERE id=?",(receivable['id'],))
                    db.execute('INSERT INTO receivable_moves(receivable_id,business_id,customer_id,sale_id,created,kind,amount,balance_after,user_id,note,request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(receivable['id'],b,receivable['customer_id'],s['id'],now(),'Anulación',-receivable['balance'],0,u['id'],clean(d['reason']),f'anulacion-{s["id"]}'))
            elif action=='void_purchase':
                self.admin(u); purchase=self.one(db,"SELECT * FROM purchases WHERE id=? AND business_id=?",(d['purchase_id'],b)); require(purchase and purchase['status']=='Activa','Compra no disponible para anular'); reason=clean(d.get('reason')); require(reason,'Escriba el motivo')
                pls=self.rows(db,'SELECT pl.*,l.qty lot_qty FROM purchase_lines pl JOIN lots l ON l.id=pl.lot_id WHERE pl.purchase_id=?',(purchase['id'],))
                for line in pls: require(line['lot_qty']>=line['qty']-line['returned_qty'],'No se puede anular: existen ventas o movimientos posteriores. Registre una devolución parcial.')
                for line in pls:
                    remaining=line['qty']-line['returned_qty']; p=self.scoped(db,'products',line['product_id'],b); db.execute('UPDATE lots SET qty=qty-?,status=? WHERE id=?',(remaining,'Anulada',line['lot_id'])); balance=db.execute('SELECT COALESCE(SUM(qty),0) FROM lots WHERE product_id=?',(p['id'],)).fetchone()[0]
                    db.execute('INSERT INTO stock_moves(business_id,product_id,lot_id,user_id,created,qty,kind,reference,cost,cost_basis,balance_after,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(b,p['id'],line['lot_id'],u['id'],now(),-remaining,'Anulación de compra',f'COMP-{purchase["number"]:06d}',line['cost'],line['cost_basis'],balance,reason)); self.update_average(db,p)
                db.execute("UPDATE purchases SET status='Anulada',note=note || ? WHERE id=?",('\nAnulación: '+reason,purchase['id']))
            elif action in ('purchase_return','manual_purchase_return'):
                self.admin(u); manual=action=='manual_purchase_return'; reason=clean(d.get('reason')); require(reason,'Escriba el motivo de la devolución'); request=clean(d.get('request_id')) or secrets.token_urlsafe(18)
                if manual:
                    lot=self.scoped(db,'lots',d['lot_id'],b); p=self.scoped(db,'products',lot['product_id'],b); q=quantity(d['qty'],p['unit']); require(0<q<=lot['qty'],'Cantidad superior al inventario disponible'); cost=money(d.get('cost') or lot['cost']); basis=lot['cost_basis']; purchase=None; purchase_line=None; supplier=clean(d.get('supplier')) or lot['supplier']
                else:
                    purchase_line=self.one(db,'SELECT pl.*,p.business_id,p.unit,pu.supplier,pu.status purchase_status FROM purchase_lines pl JOIN products p ON p.id=pl.product_id JOIN purchases pu ON pu.id=pl.purchase_id WHERE pl.id=? AND p.business_id=?',(d['purchase_line_id'],b)); require(purchase_line and purchase_line['purchase_status']!='Anulada','Línea de compra no disponible'); lot=self.scoped(db,'lots',purchase_line['lot_id'],b); p=self.scoped(db,'products',purchase_line['product_id'],b); q=quantity(d['qty'],p['unit']); require(0<q<=purchase_line['qty']-purchase_line['returned_qty'] and q<=lot['qty'],'Cantidad superior a la comprada o disponible'); cost=purchase_line['cost']; basis=purchase_line['cost_basis']; purchase=purchase_line['purchase_id']; supplier=purchase_line['supplier']
                total=amount(q,cost,p['unit'],basis); number=db.execute('SELECT COALESCE(MAX(number),0)+1 FROM purchase_returns WHERE business_id=?',(b,)).fetchone()[0]
                rid=db.execute('INSERT INTO purchase_returns(business_id,number,purchase_id,supplier,created,user_id,reason,note,total,manual,request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(b,number,purchase,supplier,now(),u['id'],reason,clean(d.get('note'),1000),total,int(manual),request)).lastrowid
                db.execute('INSERT INTO purchase_return_lines(return_id,purchase_line_id,product_id,lot_id,qty,cost,cost_basis,total) VALUES(?,?,?,?,?,?,?,?)',(rid,purchase_line['id'] if purchase_line else None,p['id'],lot['id'],q,cost,basis,total)); db.execute('UPDATE lots SET qty=qty-? WHERE id=?',(q,lot['id']))
                if purchase_line:
                    db.execute('UPDATE purchase_lines SET returned_qty=returned_qty+? WHERE id=?',(q,purchase_line['id'])); pending=db.execute('SELECT SUM(qty-returned_qty) FROM purchase_lines WHERE purchase_id=?',(purchase,)).fetchone()[0]; db.execute('UPDATE purchases SET status=? WHERE id=?',('Devuelta' if pending==0 else 'Parcialmente devuelta',purchase))
                balance=db.execute('SELECT COALESCE(SUM(qty),0) FROM lots WHERE product_id=?',(p['id'],)).fetchone()[0]; db.execute('INSERT INTO stock_moves(business_id,product_id,lot_id,user_id,created,qty,kind,reference,cost,cost_basis,balance_after,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(b,p['id'],lot['id'],u['id'],now(),-q,'Devolución de compra',f'DCP-{number:06d}',cost,basis,balance,reason)); self.update_average(db,p); result['id']=rid
            elif action=='sale_return':
                self.admin(u); c=self.cash(db,b); line=self.one(db,'SELECT l.*,s.business_id,s.customer_id,s.cash_id,s.debt,s.status sale_status FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE l.id=? AND s.business_id=?',(d['sale_line_id'],b)); require(line and line['sale_status']=='active','Línea de venta no disponible'); q=quantity(d['qty'],line['unit']); returned=db.execute('SELECT COALESCE(SUM(qty),0) FROM sales_return_lines WHERE sale_line_id=?',(line['id'],)).fetchone()[0]; require(0<q<=line['qty']-returned,'La devolución supera la cantidad vendida'); method=d.get('method'); require(method in METHODS,'Medio de devolución inválido'); reason=clean(d.get('reason')); require(reason,'Escriba el motivo'); total=amount(q,line['price'],line['unit'],line['price_basis']); cost=int((Decimal(q)*line['cost']/line['qty']).quantize(Decimal('1'),rounding=ROUND_HALF_UP)); debt_reduction=min(total,line['debt']); refund=total-debt_reduction
                if method=='Efectivo': require(self.expected(db,c)>=refund,'No hay efectivo suficiente para realizar la devolución')
                number=db.execute('SELECT COALESCE(MAX(number),0)+1 FROM sales_returns WHERE business_id=?',(b,)).fetchone()[0]; request=clean(d.get('request_id')) or secrets.token_urlsafe(18); restock=int(bool(d.get('restock')))
                rid=db.execute('INSERT INTO sales_returns(business_id,number,sale_id,customer_id,cash_id,created,user_id,reason,note,refund_method,total,debt_reduction,stock_return,request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(b,number,line['sale_id'],line['customer_id'],c['id'],now(),u['id'],reason,clean(d.get('note'),1000),method,total,debt_reduction,restock,request)).lastrowid
                db.execute('INSERT INTO sales_return_lines(return_id,sale_line_id,product_id,qty,price,price_basis,total,cost,restock) VALUES(?,?,?,?,?,?,?,?,?)',(rid,line['id'],line['product_id'],q,line['price'],line['price_basis'],total,cost,restock))
                if debt_reduction:
                    db.execute('UPDATE sales SET debt=debt-? WHERE id=?',(debt_reduction,line['sale_id'])); rec=self.one(db,'SELECT * FROM receivables WHERE sale_id=?',(line['sale_id'],)); require(rec,'Cuenta por cobrar no encontrada'); new=rec['balance']-debt_reduction; db.execute('UPDATE receivables SET returned_amount=returned_amount+?,balance=?,status=? WHERE id=?',(debt_reduction,new,'Pagado' if new==0 else 'Parcialmente pagado',rec['id'])); db.execute('INSERT INTO receivable_moves(receivable_id,business_id,customer_id,sale_id,created,kind,amount,balance_after,user_id,note,request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(rec['id'],b,rec['customer_id'],line['sale_id'],now(),'Devolución',-debt_reduction,new,u['id'],reason,request+':cartera'))
                if refund: db.execute('INSERT INTO payments(business_id,sale_id,cash_id,user_id,created,method,amount,kind,reference) VALUES(?,?,?,?,?,?,?,?,?)',(b,line['sale_id'],c['id'],u['id'],now(),method,-refund,'Devolución',f'DVT-{number:06d}'))
                if restock:
                    remaining=q
                    for a in json.loads(line['allocations']):
                        take=min(remaining,a['qty']);
                        if take:
                            db.execute('UPDATE lots SET qty=qty+? WHERE id=?',(take,a['lot_id'])); lot=self.one(db,'SELECT cost,cost_basis FROM lots WHERE id=?',(a['lot_id'],)); balance=db.execute('SELECT COALESCE(SUM(qty),0) FROM lots WHERE product_id=?',(line['product_id'],)).fetchone()[0]; db.execute('INSERT INTO stock_moves(business_id,product_id,lot_id,user_id,created,qty,kind,reference,cost,cost_basis,balance_after,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(b,line['product_id'],a['lot_id'],u['id'],now(),take,'Devolución de venta',f'DVT-{number:06d}',lot['cost'],lot['cost_basis'],balance,reason)); remaining-=take
                        if not remaining: break
                result['id']=rid
            elif action=='settings':
                self.admin(u); require(clean(d.get('name')),'Indique nombre del negocio'); require(int(d.get('receipt_width',80)) in (58,80),'Ancho inválido')
                email=clean(d.get('email')); require(not email or re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',email),'Correo inválido')
                db.execute('UPDATE businesses SET name=?,nit=?,address=?,phone=?,email=?,receipt_width=? WHERE id=?',(clean(d['name']),clean(d.get('nit')),clean(d.get('address')),clean(d.get('phone')),email,int(d.get('receipt_width',80)),b))
            elif action=='user':
                self.admin(u); role=d.get('role'); businesses=d.get('businesses',[1,2]); require(role in ('admin','cashier') and businesses and all(x in (1,2) for x in businesses),'Permisos inválidos')
                require(clean(d.get('username')) and clean(d.get('name')),'Complete usuario y nombre'); user_id=int(d.get('id') or 0)
                if user_id:
                    target=self.one(db,'SELECT * FROM users WHERE id=?',(user_id,)); require(target,'Usuario no encontrado')
                    require(user_id!=u['id'] or bool(d.get('active',True)),'No puede desactivar su propia cuenta')
                    db.execute('UPDATE users SET username=?,name=?,role=?,businesses=?,active=? WHERE id=?',(clean(d['username']).lower(),clean(d['name']),role,json.dumps(businesses),int(bool(d.get('active',True))),user_id))
                    if d.get('password'): db.execute('UPDATE users SET password=? WHERE id=?',(password_hash(str(d['password'])),user_id))
                    db.execute('DELETE FROM finance_permissions WHERE user_id=?',(user_id,))
                    if not d.get('active',True): db.execute('DELETE FROM sessions WHERE user_id=?',(user_id,))
                else:
                    user_id=db.execute('INSERT INTO users(username,name,password,role,businesses) VALUES(?,?,?,?,?)',(clean(d['username']).lower(),clean(d['name']),password_hash(str(d.get('password',''))),role,json.dumps(businesses))).lastrowid
                for business_id in businesses:
                    keys=('view','create','edit','void','authorize','export'); values=[int(bool(d.get(f'finance_{business_id}_{key}'))) for key in keys]
                    db.execute('INSERT INTO finance_permissions(user_id,business_id,can_view,can_create,can_edit,can_void,can_authorize,can_export,can_write,can_report) VALUES(?,?,?,?,?,?,?,?,?,?)',(user_id,business_id,*values,values[1],values[5]))
                db.execute('INSERT OR REPLACE INTO dairy_permissions(user_id,can_view,can_price,can_void,can_close,can_reopen) VALUES(?,?,?,?,?,?)',(user_id,*[int(bool(d.get('dairy_'+key))) for key in ('view','price','void','close','reopen')]))
                result['id']=user_id
            elif action=='change_password':
                old=db.execute('SELECT password FROM users WHERE id=?',(u['id'],)).fetchone()[0]; require(password_check(str(d.get('current','')),old),'Contraseña actual incorrecta')
                db.execute('UPDATE users SET password=? WHERE id=?',(password_hash(str(d.get('password',''))),u['id'])); db.execute('DELETE FROM sessions WHERE user_id=?',(u['id'],))
            elif action=='email':
                self.scoped(db,'sales',d['sale_id'],b); recipient=clean(d.get('recipient')); require(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',recipient),'Correo inválido')
                result['id']=db.execute("INSERT INTO document_emails(business_id,kind,document_id,recipient,created) VALUES(?,'sale',?,?,?)",(b,d['sale_id'],recipient,now())).lastrowid
            elif action=='quote_email':
                self.scoped(db,'quotes',d['quote_id'],b); recipient=clean(d.get('recipient')); require(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',recipient),'Correo inválido')
                result['id']=db.execute("INSERT INTO document_emails(business_id,kind,document_id,recipient,created) VALUES(?,'quote',?,?,?)",(b,d['quote_id'],recipient,now())).lastrowid
            elif action=='test_email':
                self.admin(u); recipient=clean(d.get('recipient')); require(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',recipient),'Correo inválido')
                self.send_test_email(recipient); result['tested']=True
            else: raise ValueError('Acción desconocida')
            # Never persist secrets in the audit trail.
            detail={k:v for k,v in d.items() if k not in ('password','current')}
            self.audit(db,u,b,action,detail)
            return result
    def history(self,u,b,start,end):
        start=iso(start); end=iso(end); require(start<=end,'Rango de fechas inválido')
        with self.connect() as db:
            sales=self.rows(db,"SELECT s.*,c.name customer,c.phone customer_phone,c.document customer_document,c.email customer_email,u.name operator,COALESCE((SELECT GROUP_CONCAT(method||': '||printf('%.2f',amount/100.0),' · ') FROM (SELECT method,SUM(amount) amount FROM (SELECT method,amount FROM payments WHERE sale_id=s.id AND amount>0 UNION ALL SELECT method,amount FROM dairy_payments WHERE sale_id=s.id AND amount>0) GROUP BY method)),'Fiado') payment_methods FROM sales s LEFT JOIN customers c ON c.id=s.customer_id JOIN users u ON u.id=s.user_id WHERE s.business_id=? AND s.total>0 AND substr(s.created,1,10) BETWEEN ? AND ? ORDER BY s.id DESC",(b,start,end))
            debts=self.rows(db,"SELECT s.*,c.name customer,c.phone FROM sales s JOIN customers c ON c.id=s.customer_id WHERE s.business_id=? AND s.debt>0 AND s.status='active' ORDER BY s.due,s.id",(b,))
            if u['role']!='admin':
                for s in sales+debts: s.pop('cost',None)
            result={'sales':sales,'debts':debts,'receivable_moves':self.rows(db,'SELECT m.*,c.name customer FROM receivable_moves m JOIN customers c ON c.id=m.customer_id WHERE m.business_id=? ORDER BY m.id DESC LIMIT 500',(b,)),'quotes':self.rows(db,'SELECT q.id,q.created,q.valid_until,q.total,q.converted_sale,c.name customer,c.phone customer_phone,c.email customer_email FROM quotes q LEFT JOIN customers c ON c.id=q.customer_id WHERE q.business_id=? ORDER BY q.id DESC',(b,)), 'cash_sessions':self.rows(db,'SELECT * FROM cash_sessions WHERE business_id=? ORDER BY id DESC LIMIT 200',(b,)), 'emails':self.rows(db,'SELECT * FROM document_emails WHERE business_id=? ORDER BY id DESC LIMIT 100',(b,)), 'purchases':self.rows(db,'SELECT p.*,u.name operator FROM purchases p JOIN users u ON u.id=p.user_id WHERE p.business_id=? ORDER BY p.id DESC',(b,)), 'purchase_lines':self.rows(db,'SELECT pl.*,p.name,p.unit,pu.number purchase_number,pu.supplier,pu.status purchase_status FROM purchase_lines pl JOIN products p ON p.id=pl.product_id JOIN purchases pu ON pu.id=pl.purchase_id WHERE pu.business_id=? ORDER BY pl.id DESC',(b,)), 'purchase_returns':self.rows(db,'SELECT r.*,u.name operator FROM purchase_returns r JOIN users u ON u.id=r.user_id WHERE r.business_id=? ORDER BY r.id DESC',(b,)), 'sale_lines':self.rows(db,'SELECT l.*,s.number sale_number,s.status sale_status,c.name customer FROM sale_lines l JOIN sales s ON s.id=l.sale_id LEFT JOIN customers c ON c.id=s.customer_id WHERE s.business_id=? ORDER BY l.id DESC',(b,)), 'sales_returns':self.rows(db,'SELECT r.*,u.name operator FROM sales_returns r JOIN users u ON u.id=r.user_id WHERE r.business_id=? ORDER BY r.id DESC',(b,))}
            if u['role']=='admin':
                result['stock_moves']=self.rows(db,'SELECT m.*,p.name,p.unit,l.code,u.name operator FROM stock_moves m JOIN products p ON p.id=m.product_id JOIN lots l ON l.id=m.lot_id JOIN users u ON u.id=m.user_id WHERE m.business_id=? AND substr(m.created,1,10) BETWEEN ? AND ? ORDER BY m.id DESC',(b,start,end))
                result['payments']=self.rows(db,'SELECT method,kind,SUM(amount) amount FROM payments WHERE business_id=? AND substr(created,1,10) BETWEEN ? AND ? GROUP BY method,kind',(b,start,end))
                result['top']=self.rows(db,"SELECT l.product_id,l.name,l.unit,SUM(l.qty) qty,SUM(l.total) total,SUM(l.total-l.cost) margin FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.business_id=? AND s.status='active' AND substr(s.created,1,10) BETWEEN ? AND ? GROUP BY l.product_id,l.name,l.unit ORDER BY total DESC",(b,start,end))
                result['audit']=self.rows(db,'SELECT a.created,a.action,u.name operator,a.detail FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.business_id=? AND substr(a.created,1,10) BETWEEN ? AND ? ORDER BY a.id DESC LIMIT 500',(b,start,end))
                result['cash_moves']=self.rows(db,'SELECT * FROM cash_moves WHERE business_id=? AND substr(created,1,10) BETWEEN ? AND ? ORDER BY id DESC',(b,start,end))
                result['users']=self.rows(db,'SELECT id,username,name,role,businesses,active FROM users')
                result['finance_permissions']=self.rows(db,'SELECT * FROM finance_permissions ORDER BY user_id,business_id')
                result['dairy_permissions']=self.rows(db,'SELECT * FROM dairy_permissions ORDER BY user_id')
            return result
    def analytics(self,u,b,start,end):
        self.admin(u); start=iso(start); end=iso(end); require(start<=end,'Rango de fechas inválido')
        with self.connect() as db:
            args=(b,start,end)
            summary=self.one(db,"SELECT COUNT(*) transactions,COALESCE(SUM(total),0) sales,COALESCE(SUM(cost),0) cost,COALESCE(SUM(debt),0) pending_from_period FROM sales WHERE business_id=? AND status='active' AND total>0 AND substr(created,1,10) BETWEEN ? AND ?",args)
            summary['margin']=summary['sales']-summary['cost']; summary['average_ticket']=round(summary['sales']/summary['transactions']) if summary['transactions'] else 0
            summary['receivables']=db.execute("SELECT COALESCE(SUM(balance),0) FROM receivables WHERE business_id=? AND status IN ('Pendiente','Parcialmente pagado')",(b,)).fetchone()[0]
            summary['inventory_value']=db.execute("SELECT COALESCE(SUM(CASE p.unit WHEN 'g' THEN l.qty*l.cost/l.cost_basis WHEN 'm' THEN l.qty*l.cost/1000 ELSE l.qty*l.cost END),0) FROM lots l JOIN products p ON p.id=l.product_id WHERE l.business_id=? AND l.qty>0",(b,)).fetchone()[0]
            daily=self.rows(db,"SELECT substr(created,1,10) day,COUNT(*) transactions,SUM(total) sales,SUM(total-cost) margin FROM sales WHERE business_id=? AND status='active' AND substr(created,1,10) BETWEEN ? AND ? GROUP BY day ORDER BY day",args)
            categories=self.rows(db,"SELECT COALESCE(NULLIF(p.category,''),'Sin categoría') category,SUM(l.total) sales,SUM(l.total-l.cost) margin FROM sale_lines l JOIN sales s ON s.id=l.sale_id JOIN products p ON p.id=l.product_id WHERE s.business_id=? AND s.status='active' AND substr(s.created,1,10) BETWEEN ? AND ? GROUP BY category ORDER BY sales DESC",args)
            payments=self.rows(db,"SELECT method,SUM(amount) amount FROM payments WHERE business_id=? AND substr(created,1,10) BETWEEN ? AND ? GROUP BY method ORDER BY amount DESC",args)
            sellers=self.rows(db,"SELECT u.name seller,COUNT(*) transactions,SUM(s.total) sales,SUM(s.total-s.cost) margin FROM sales s JOIN users u ON u.id=s.user_id WHERE s.business_id=? AND s.status='active' AND s.total>0 AND substr(s.created,1,10) BETWEEN ? AND ? GROUP BY s.user_id,u.name ORDER BY sales DESC",args)
            rotation=self.rows(db,"""WITH sold AS (SELECT l.product_id,SUM(CASE WHEN substr(s.created,1,10)>=date('now','-7 day') THEN l.qty ELSE 0 END) sold7,SUM(CASE WHEN substr(s.created,1,10)>=date('now','-30 day') THEN l.qty ELSE 0 END) sold30,SUM(CASE WHEN substr(s.created,1,10)>=date('now','-90 day') THEN l.qty ELSE 0 END) sold90,SUM(CASE WHEN substr(s.created,1,10)>=date('now','-90 day') THEN l.total ELSE 0 END) revenue90 FROM sale_lines l JOIN sales s ON s.id=l.sale_id WHERE s.business_id=? AND s.status='active' GROUP BY l.product_id), ranked AS (SELECT p.id,p.name,p.sku,p.unit,p.min_stock,p.max_stock,p.reorder_point,p.lead_time_days,COALESCE(SUM(l.qty),0) stock,COALESCE(x.sold7,0) sold7,COALESCE(x.sold30,0) sold30,COALESCE(x.sold90,0) sold90,COALESCE(x.revenue90,0) revenue90 FROM products p LEFT JOIN lots l ON l.product_id=p.id LEFT JOIN sold x ON x.product_id=p.id WHERE p.business_id=? AND p.active=1 GROUP BY p.id) SELECT *,ROUND(sold30/30.0,2) daily_average,CASE WHEN sold30>0 THEN ROUND(stock/(sold30/30.0),1) ELSE NULL END days_stock,CASE WHEN sold30=0 THEN 0 ELSE MAX(0,COALESCE(NULLIF(max_stock,0),MAX(min_stock*2,reorder_point))-stock) END suggested_qty FROM ranked ORDER BY revenue90 DESC,name""",(b,b))
            total_revenue=sum(x['revenue90'] for x in rotation); cumulative=0
            for item in rotation:
                cumulative+=item['revenue90']; ratio=cumulative/total_revenue if total_revenue else 1
                item['abc']='A' if ratio<=.8 else 'B' if ratio<=.95 else 'C'; item['rotation']='Alta' if item['sold30']>item['stock'] else 'Media' if item['sold30'] else 'Sin movimiento'
            suggestions=[x for x in rotation if x['suggested_qty']>0 or x['stock']<=max(x['min_stock'],x['reorder_point'])]
            aging=self.rows(db,"SELECT CASE WHEN julianday('now')-julianday(COALESCE(s.due,substr(s.created,1,10)))<=0 THEN 'Por vencer' WHEN julianday('now')-julianday(COALESCE(s.due,substr(s.created,1,10)))<=30 THEN '1 a 30 días' WHEN julianday('now')-julianday(COALESCE(s.due,substr(s.created,1,10)))<=60 THEN '31 a 60 días' ELSE 'Más de 60 días' END bucket,SUM(r.balance) amount,COUNT(*) accounts FROM receivables r JOIN sales s ON s.id=r.sale_id WHERE r.business_id=? AND r.balance>0 GROUP BY bucket",(b,))
            cash=self.rows(db,"""SELECT c.id,c.opened,c.closed,c.opening,c.expected,c.counted,c.difference,c.difference_type,c.difference_reason,c.difference_note,u.name operator,
              COALESCE((SELECT SUM(amount) FROM payments WHERE cash_id=c.id AND method='Efectivo' AND kind='Venta'),0) cash_sales,
              COALESCE((SELECT SUM(amount) FROM payments WHERE cash_id=c.id AND method='Efectivo' AND kind='Abono'),0) cash_collections,
              COALESCE((SELECT SUM(amount) FROM cash_moves WHERE cash_id=c.id AND amount>0),0) other_income,
              COALESCE((SELECT -SUM(amount) FROM cash_moves WHERE cash_id=c.id AND amount<0),0) expenses,
              COALESCE((SELECT -SUM(amount) FROM payments WHERE cash_id=c.id AND method='Efectivo' AND amount<0),0) cash_refunds
              FROM cash_sessions c JOIN users u ON u.id=c.user_id WHERE c.business_id=? AND substr(c.opened,1,10) BETWEEN ? AND ? ORDER BY c.id DESC LIMIT 200""",args)
            return {'summary':summary,'daily':daily,'categories':categories,'payments':payments,'sellers':sellers,'rotation':rotation,'suggestions':suggestions,'aging':aging,'cash':cash,'start':start,'end':end}
    def inventory_report(self,u,b,category='',status='',search='',in_stock=False):
        self.admin(u)
        with self.connect() as db:
            business=self.one(db,'SELECT * FROM businesses WHERE id=?',(b,)); items=self.rows(db,"""SELECT p.*,COALESCE(SUM(l.qty),0) stock,MAX(CASE WHEN l.purchase_id IS NOT NULL THEN substr(l.created,1,10) END) last_purchase,(SELECT MAX(substr(s.created,1,10)) FROM sale_lines sl JOIN sales s ON s.id=sl.sale_id WHERE sl.product_id=p.id AND s.status='active') last_sale,(SELECT supplier FROM lots lx WHERE lx.product_id=p.id ORDER BY lx.original_qty DESC,lx.id DESC LIMIT 1) supplier,COALESCE((SELECT SUM(sl.qty) FROM sale_lines sl JOIN sales s ON s.id=sl.sale_id WHERE sl.product_id=p.id AND s.status='active' AND substr(s.created,1,10)>=date('now','-30 day')),0) sold30 FROM products p LEFT JOIN lots l ON l.product_id=p.id WHERE p.business_id=? AND p.active=1 GROUP BY p.id ORDER BY p.category,p.name""",(b,))
            result=[]
            for x in items:
                target=x['max_stock'] or max(x['min_stock']*2,x['reorder_point']); stock=x['stock']; daily=x['sold30']/30
                state='Agotado' if stock<=0 else 'Stock crítico' if stock<=x['reorder_point'] else 'Stock bajo' if stock<=x['min_stock'] else 'Sobreinventario' if x['max_stock'] and stock>x['max_stock'] else 'Stock adecuado'
                divisor=x['price_basis'] if x['unit']=='g' else 1000 if x['unit']=='m' else 1; inv_cost=round(stock*x['current_cost']/divisor); inv_sale=round(stock*x['price']/divisor)
                x.update(status=state,target_stock=target,inventory_cost=inv_cost,inventory_sale=inv_sale,unit_margin=x['price']-x['current_cost'],margin_rate=(x['price']-x['current_cost'])/x['price'] if x['price'] else 0,days_stock=round(stock/daily,1) if daily else None)
                if category and x['category']!=category: continue
                if status and state!=status: continue
                if search.lower() not in (x['name']+' '+x['sku']+' '+(x['barcode'] or '')).lower(): continue
                if in_stock and stock<=0: continue
                result.append(x)
            return business,result
    def report_rows(self,u,b,kind,start,end):
        self.admin(u); start=iso(start); end=iso(end); require(start<=end,'Rango de fechas inválido')
        with self.connect() as db:
            business=self.one(db,'SELECT * FROM businesses WHERE id=?',(b,)); args=(b,start,end)
            if kind=='ventas': headers=['Venta','Fecha','Cliente','Usuario','Caja','Total','Costo','Utilidad','Fiado','Estado']; raw=self.rows(db,"SELECT s.number,s.created,COALESCE(c.name,'Consumidor final') customer,u.name operator,s.cash_id,s.total,s.cost,s.total-s.cost profit,s.original_debt,CASE s.status WHEN 'void' THEN 'Anulada' ELSE 'Registrada' END state FROM sales s LEFT JOIN customers c ON c.id=s.customer_id JOIN users u ON u.id=s.user_id WHERE s.business_id=? AND s.total>0 AND substr(s.created,1,10) BETWEEN ? AND ? ORDER BY s.created",args); data=[list(x.values()) for x in raw]; money_cols=(5,6,7,8); totals=(5,6,7,8); title='Reporte de ventas'
            elif kind=='recaudos': headers=['Fecha','Cliente','Venta','Movimiento','Valor aplicado','Saldo posterior','Usuario','Observación']; raw=self.rows(db,"SELECT m.created,c.name,m.sale_id,m.kind,ABS(m.amount) amount,m.balance_after,u.name operator,m.note FROM receivable_moves m JOIN customers c ON c.id=m.customer_id JOIN users u ON u.id=m.user_id WHERE m.business_id=? AND substr(m.created,1,10) BETWEEN ? AND ? AND m.kind LIKE 'Abono%' ORDER BY m.created",args); data=[list(x.values()) for x in raw]; money_cols=(4,5); totals=(4,); title='Reporte de recaudos'
            elif kind=='cartera': headers=['Cliente','Documento','Teléfono','Fecha venta','Vencimiento','Valor original','Valor abonado','Saldo','Estado']; raw=self.rows(db,"SELECT c.name,c.document,c.phone,substr(s.created,1,10),s.due,r.original_amount,r.paid_amount,r.balance,r.status FROM receivables r JOIN customers c ON c.id=r.customer_id JOIN sales s ON s.id=r.sale_id WHERE r.business_id=? ORDER BY c.name,s.created",(b,)); data=[list(x.values()) for x in raw]; money_cols=(5,6,7); totals=(5,6,7); title='Reporte de cartera'
            elif kind=='kardex': headers=['Fecha','Producto','Lote','Movimiento','Documento','Entrada','Salida','Saldo','Costo unitario','Usuario','Observación']; raw=self.rows(db,"SELECT m.created,p.name product,l.code,m.kind,m.reference,CASE WHEN m.qty>0 THEN m.qty ELSE 0 END incoming,CASE WHEN m.qty<0 THEN -m.qty ELSE 0 END outgoing,m.balance_after,m.cost,u.name operator,m.note FROM stock_moves m JOIN products p ON p.id=m.product_id JOIN lots l ON l.id=m.lot_id JOIN users u ON u.id=m.user_id WHERE m.business_id=? AND substr(m.created,1,10) BETWEEN ? AND ? ORDER BY m.created,m.id",args); data=[list(x.values()) for x in raw]; money_cols=(8,); totals=(); title='Kardex'
            elif kind=='caja': headers=['Caja','Apertura','Cierre','Usuario','Base inicial','Esperado','Contado','Diferencia','Tipo','Razón','Observación']; raw=self.rows(db,"SELECT c.id,c.opened,c.closed,u.name,c.opening,c.expected,c.counted,c.difference,c.difference_type,c.difference_reason,c.difference_note FROM cash_sessions c JOIN users u ON u.id=c.user_id WHERE c.business_id=? AND substr(c.opened,1,10) BETWEEN ? AND ? ORDER BY c.opened",args); data=[list(x.values()) for x in raw]; money_cols=(4,5,6,7); totals=(4,7); title='Reporte de caja'
            elif kind=='auditoria': headers=['Fecha','Usuario','Acción','Detalle']; raw=self.rows(db,"SELECT a.created,COALESCE(u.name,'Sistema'),a.action,a.detail FROM audit a LEFT JOIN users u ON u.id=a.user_id WHERE a.business_id=? AND substr(a.created,1,10) BETWEEN ? AND ? ORDER BY a.created",args); data=[list(x.values()) for x in raw]; money_cols=(); totals=(); title='Reporte de auditoría'
            else: raise ValueError('Reporte inválido')
            return business,title,headers,data,money_cols,totals
    def receipt_data(self,db,b,kind,id):
        business=self.one(db,'SELECT * FROM businesses WHERE id=?',(b,))
        if kind=='sale':
            data=self.scoped(db,'sales',id,b); data['lines']=self.rows(db,'SELECT * FROM sale_lines WHERE sale_id=?',(id,)); data['payments']=self.rows(db,'SELECT * FROM payments WHERE sale_id=? ORDER BY id',(id,)); data['own_total']=data['total']; data['total']+=data.get('dairy_total',0); data['title']='Recibo de venta'; data['code']=('MM' if b==1 else 'FE')+f"-{data['number']:06d}"
            for x in self.rows(db,'SELECT * FROM unregistered_sale_lines WHERE sale_id=? ORDER BY id',(id,)):
                data['lines'].append({'name':x['description'],'sku':'NO-CATALOGADO','unit':x['unit'],'qty':x['qty'],'price':x['price'],'total':x['total'],'price_basis':1})
            for x in self.rows(db,'SELECT l.*,p.name,p.unit FROM dairy_sale_lines l JOIN dairy_products p ON p.id=l.product_id WHERE l.sale_id=? ORDER BY l.id',(id,)):
                data['lines'].append({'name':x['name'],'sku':'LACTEO-TERCERO','unit':x['unit'],'qty':x['qty'],'price':x['price'],'total':x['total'],'price_basis':1000})
            data['payments']+=self.rows(db,"SELECT id,sale_id,NULL cash_id,NULL user_id,created,method,amount,'Lácteo tercero' kind,'' reference FROM dairy_payments WHERE sale_id=? ORDER BY id",(id,))
        elif kind=='quote':
            data=self.scoped(db,'quotes',id,b); data['lines']=json.loads(data['lines']); data['title']='Cotización'; data['code']=f'COT-{id:06d}'
        elif kind in ('cash','cash_open'):
            data=self.scoped(db,'cash_sessions',id,b); data['title']='Cierre de caja' if data['closed'] else 'Apertura de caja'; data['code']=f'CAJA-{id:06d}'; data['created']=data['opened']; data['payments']=self.rows(db,'SELECT method,SUM(amount) amount FROM payments WHERE cash_id=? GROUP BY method',(id,)); data['moves']=self.rows(db,'SELECT * FROM cash_moves WHERE cash_id=?',(id,)); data['expected']=data['expected'] if data['closed'] else self.expected(db,data)
            if kind=='cash_open':
                data.update(title='Apertura de caja',closed=None,counted=None,expected=data['opening'],payments=[],moves=[],note=data['note'].split('\nCierre: ')[0])
        elif kind=='payment':
            data=self.one(db,"SELECT * FROM payments WHERE id=? AND business_id=? AND kind='Abono'",(id,b)); require(data,'Abono no encontrado'); s=self.scoped(db,'sales',data['sale_id'],b); data.update(customer_id=s['customer_id'],balance=s['debt'],title='Recibo de abono',code=f'AB-{id:06d}')
        elif kind=='collection':
            data=self.one(db,'SELECT * FROM collections WHERE id=? AND business_id=?',(id,b)); require(data,'Recaudo no encontrado')
            data.update(title='Recibo de abono a cartera',code=f'RC-{id:06d}',balance=db.execute('SELECT COALESCE(SUM(balance),0) FROM receivables WHERE customer_id=?',(data['customer_id'],)).fetchone()[0])
            data['allocations']=self.rows(db,'SELECT a.*,s.number FROM collection_allocations a JOIN sales s ON s.id=a.sale_id WHERE a.collection_id=? ORDER BY a.id',(id,))
        else: raise ValueError('Recibo inválido')
        data['operator']=db.execute('SELECT name FROM users WHERE id=?',(data['user_id'],)).fetchone()[0]
        data['customer']=self.scoped(db,'customers',data['customer_id'],b) if data.get('customer_id') else None
        return business,data
    def receipt(self,b,kind,id):
        with self.connect() as db: business,d=self.receipt_data(db,b,kind,id)
        e=lambda x:html.escape(str(x or '')); fmt=lambda x:'$ '+f'{x/100:,.2f}'; rows=[]
        if kind=='quote':
            customer=d.get('customer') or {}; table=[]
            for l in d.get('lines',[]):
                q=l['qty']/1000 if l['unit'] in ('m','litro','libra') else l['qty']; unit=('libra (500 g)' if l.get('price_basis',1000)==500 else 'kg') if l['unit']=='g' else l['unit']
                table.append(f"<tr><td>{e(l['sku'])}</td><td><b>{e(l['name'])}</b><br><small>{e(l.get('description',''))}</small></td><td>{q:g}</td><td>{e(unit)}</td><td>{fmt(l['price'])}</td><td>{fmt(l['total'])}</td></tr>")
            return f'''<!doctype html><html lang="es"><meta charset="utf-8"><title>{e(d['code'])}</title><style>@page{{size:letter;margin:16mm}}*{{box-sizing:border-box}}body{{font:13px Arial,sans-serif;color:#18231b;margin:0}}header{{display:flex;justify-content:space-between;border-bottom:4px solid #d8ad20;padding-bottom:16px}}h1{{margin:0;color:#273219}}.doc{{text-align:right}}.doc b{{font-size:22px}}.parties{{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin:24px 0}}.box{{border:1px solid #d9ded8;border-radius:8px;padding:14px}}table{{width:100%;border-collapse:collapse}}th{{background:#273219;color:white;text-align:left;padding:9px}}td{{padding:9px;border-bottom:1px solid #e5e8e4}}td:nth-last-child(-n+2){{text-align:right}}.totals{{margin:18px 0 18px auto;width:280px}}.totals p{{display:flex;justify-content:space-between}}.totals .grand{{font-size:19px;border-top:2px solid #273219;padding-top:10px}}footer{{margin-top:35px;border-top:1px solid #ddd;padding-top:14px;color:#59625c}}button{{padding:10px 16px;margin-bottom:15px}}@media print{{button{{display:none}}}}</style><button onclick="window.print()">Imprimir / guardar PDF</button><header><div><h1>{e(business['name'])}</h1><p>NIT: {e(business['nit'])}<br>{e(business['address'])}<br>{e(business['phone'])}<br>{e(business.get('email',''))}</p></div><div class="doc"><b>COTIZACIÓN</b><p>{e(d['code'])}<br>Fecha: {e(d['created'][:10])}<br>Válida hasta: {e(d['valid_until'])}</p></div></header><section class="parties"><div class="box"><b>Cliente</b><p>{e(customer.get('name','Consumidor final'))}<br>{e(customer.get('document',''))}<br>{e(customer.get('phone',''))}<br>{e(customer.get('email',''))}</p></div><div class="box"><b>Preparada por</b><p>{e(d['operator'])}</p></div></section><table><thead><tr><th>Código</th><th>Descripción</th><th>Cantidad</th><th>Unidad</th><th>Precio unitario</th><th>Subtotal</th></tr></thead><tbody>{''.join(table)}</tbody></table><section class="totals"><p>Subtotal <b>{fmt(d['total'])}</b></p><p>Descuento <b>{fmt(0)}</b></p><p>Impuestos incluidos/adicionales <b>{fmt(0)}</b></p><p class="grand">Total <b>{fmt(d['total'])}</b></p></section><div class="box"><b>Observaciones y condiciones comerciales</b><p>{e(d['note'] or 'Precios sujetos a la vigencia indicada. La cotización no reserva inventario.')}</p></div><footer>Este documento es una cotización comercial y no constituye factura ni comprobante de pago.</footer></html>'''
        if d.get('customer'): rows.append('<p>Cliente: '+e(d['customer']['name'])+'<br>Documento: '+e(d['customer']['document'])+'</p>')
        for l in d.get('lines',[]):
            q=l['qty']/1000 if l['unit'] in ('m','litro','libra') else l['qty']; base=('libra (500 g)' if l.get('price_basis',1000)==500 else 'kg') if l['unit']=='g' else l['unit']
            rows.append(f"<p><b>{e(l['name'])}</b><br>{q:g} {e(l['unit'])} × {fmt(l['price'])}/{base}<strong>{fmt(l['total'])}</strong></p>")
        if 'total' in d: rows.append('<hr><h2>Total '+fmt(d['total'])+'</h2><p>Precios finales registrados en el sistema.</p>')
        for p in d.get('payments',[]): rows.append('<p>'+e(p.get('kind',''))+' '+e(p['method'])+'<strong>'+fmt(p['amount'])+'</strong></p>')
        if kind=='collection':
            rows.append('<hr><h2>Abono '+fmt(d['amount'])+'</h2><p>Medio de pago<strong>'+e(d['method'])+'</strong></p>')
            for a in d['allocations']: rows.append('<p>Factura #'+str(a['number'])+'<strong>'+fmt(a['amount'])+'</strong><br>Saldo: '+fmt(a['balance_after'])+'</p>')
            rows.append('<p><b>Saldo total del cliente</b><strong>'+fmt(d['balance'])+'</strong></p>')
        if kind=='sale':
            if d.get('cash_received'):
                rows.append('<p>Efectivo recibido<strong>'+fmt(d['cash_received'])+'</strong></p><p>Cambio entregado<strong>'+fmt(d['change_given'])+'</strong></p>')
            rows.append('<p>Fiado original<strong>'+fmt(d['original_debt'])+'</strong></p><p>Saldo actual<strong>'+fmt(d['debt'])+'</strong></p>')
            if d['due']: rows.append('<p>Fecha acordada de pago: '+e(d['due'])+'</p>')
            if d['status']=='void': rows.append('<h2>ANULADO</h2><p>'+e(d['void_reason'])+'</p>')
        if kind=='quote': rows.append('<p>Válida hasta '+e(d['valid_until'])+'</p><p>'+e(d['note'])+'</p><p>No reserva inventario. Conversión a precios vigentes.</p>')
        if kind in ('cash','cash_open'):
            rows.append('<hr><p>Base inicial<strong>'+fmt(d['opening'])+'</strong></p>')
            for m in d['moves']: rows.append('<p>'+e(m['reason'])+'<strong>'+fmt(m['amount'])+'</strong></p>')
            rows.append('<p>Efectivo esperado<strong>'+fmt(d['expected'])+'</strong></p>')
            if d['closed']: rows.append('<p>Contado<strong>'+fmt(d['counted'])+'</strong></p><p>Diferencia<strong>'+fmt(d['counted']-d['expected'])+'</strong></p><p>Cerrada: '+e(d['closed'])+'</p>')
            rows.append('<p>'+e(d['note'])+'</p>')
        if kind=='payment': rows.append('<p>'+e(d['method'])+'<strong>'+fmt(d['amount'])+'</strong></p><p>Venta interna #'+e(d['sale_id'])+'</p><p>Saldo actual<strong>'+fmt(d['balance'])+'</strong></p>')
        return f'''<!doctype html><html lang="es"><meta charset="utf-8"><title>{e(d['code'])}</title><style>body{{font:13px monospace;width:{business['receipt_width']-8}mm;margin:12px auto;color:#111}}h1{{font-size:20px}}h2{{font-size:16px}}header,footer{{text-align:center}}p{{overflow-wrap:anywhere}}strong{{float:right;margin-left:6px}}hr{{border:0;border-top:1px dashed}}button{{padding:10px;margin:8px}}@page{{size:{business['receipt_width']}mm auto;margin:4mm}}@media print{{.toolbar{{display:none}}body{{margin:0}}}}</style><div class="toolbar"><button onclick="window.print()">Imprimir / guardar PDF</button></div><header><h1>{e(business['name'])}</h1><p>{e(business['nit'])}<br>{e(business['address'])}<br>{e(business['phone'])}</p><h2>{e(d['title'])}</h2><b>{e(d['code'])}</b></header><p>{e(d['created'])}<br>Atendió: {e(d['operator'])}</p><hr>{''.join(rows)}<hr><footer><p>Comprobante interno.<br>No es factura electrónica ni documento equivalente electrónico validado por la DIAN.</p><p>Gracias por su compra</p></footer><script>if(new URLSearchParams(location.search).has('print'))window.addEventListener('load',()=>window.print())</script></html>'''
    def quote_pdf(self,b,id):
        with self.connect() as db: business,d=self.receipt_data(db,b,'quote',id)
        if not SimpleDocTemplate:
            customer=d.get('customer') or {}; lines=[business['name'].upper(),f"NIT: {business['nit']}",business['address'],business['phone'],'',f"COTIZACION {d['code']}",f"Fecha: {d['created'][:10]}    Valida hasta: {d['valid_until']}",f"Cliente: {customer.get('name','Consumidor final')}",'','CODIGO     DESCRIPCION                         CANT.       PRECIO       SUBTOTAL','-'*92]
            for item in d['lines']: lines.append(f"{item['sku'][:10]:10} {item['name'][:34]:34} {item['qty']:8} ${item['price']/100:10,.2f} ${item['total']/100:12,.2f}")
            lines += ['-'*92,f"TOTAL: ${d['total']/100:,.2f}",'',f"Observaciones: {d['note'] or 'Precios sujetos a la vigencia indicada.'}",'Este documento es una cotizacion comercial y no constituye factura.']
            return simple_pdf(lines)
        out=io.BytesIO(); doc=SimpleDocTemplate(out,pagesize=letter,rightMargin=16*mm,leftMargin=16*mm,topMargin=16*mm,bottomMargin=16*mm)
        styles=getSampleStyleSheet(); story=[Paragraph(html.escape(business['name']),styles['Title']),Paragraph(f"NIT: {html.escape(business['nit'])}<br/>{html.escape(business['address'])}<br/>{html.escape(business['phone'])}<br/>{html.escape(business.get('email',''))}",styles['Normal']),Spacer(1,7*mm),Paragraph(f"<b>COTIZACIÓN {d['code']}</b>",styles['Heading1']),Paragraph(f"Fecha: {d['created'][:10]} · Válida hasta: {d['valid_until']} · Vendedor: {html.escape(d['operator'])}",styles['Normal'])]
        if d.get('customer'): story += [Spacer(1,4*mm),Paragraph(f"<b>Cliente:</b> {html.escape(d['customer']['name'])} · {html.escape(d['customer']['document'])}<br/>{html.escape(d['customer']['phone'])} · {html.escape(d['customer']['email'])}",styles['Normal'])]
        data=[['Código','Descripción','Cant.','Unidad','P. unitario','Subtotal']]
        for l in d['lines']:
            q=l['qty']/1000 if l['unit'] in ('m','litro','libra') else l['qty']; unit=('libra' if l.get('price_basis',1000)==500 else 'kg') if l['unit']=='g' else l['unit']
            data.append([l['sku'],l['name'],f'{q:g}',unit,f"${l['price']/100:,.2f}",f"${l['total']/100:,.2f}"])
        table=PdfTable(data,colWidths=[25*mm,65*mm,16*mm,18*mm,27*mm,27*mm],repeatRows=1); table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#273219')),('TEXTCOLOR',(0,0),(-1,0),colors.white),('GRID',(0,0),(-1,-1),.35,colors.HexColor('#cdd5ce')),('VALIGN',(0,0),(-1,-1),'TOP'),('ALIGN',(2,1),(-1,-1),'RIGHT'),('FONTSIZE',(0,0),(-1,-1),8),('BOTTOMPADDING',(0,0),(-1,0),7),('TOPPADDING',(0,0),(-1,0),7)])); story += [Spacer(1,7*mm),table,Spacer(1,7*mm),Paragraph(f"<para alignment='right'><b>TOTAL: ${d['total']/100:,.2f}</b></para>",styles['Heading2']),Paragraph(f"<b>Observaciones y condiciones:</b><br/>{html.escape(d['note'] or 'Precios sujetos a vigencia. No reserva inventario.')}",styles['Normal'])]; doc.build(story); return out.getvalue()
    def invoice(self,b,id):
        require(b==2,'La factura tamaño carta está disponible únicamente en ferretería')
        with self.connect() as db: business,data=self.receipt_data(db,b,'sale',id)
        return invoice_html(business,data)
    def invoice_pdf(self,b,id):
        require(b==2,'La factura tamaño carta está disponible únicamente en ferretería')
        with self.connect() as db: business,data=self.receipt_data(db,b,'sale',id)
        return invoice_pdf(business,data)
    def receipt_text(self,b,kind,id):
        with self.connect() as db: business,d=self.receipt_data(db,b,kind,id)
        width=38 if business['receipt_width']==80 else 28; fmt=lambda x:f'$ {x/100:,.2f}'
        value_width=min(13,max(10,width//3)); label_width=width-value_width-1
        row=lambda label,value: str(label)[:label_width].ljust(label_width)+' '+str(value)[:value_width].rjust(value_width)
        wrap=lambda value:textwrap.wrap(str(value or ''),width) or ['']
        centered=lambda value:[line.center(width) for line in wrap(value)]
        out=[*centered(business['name']),*centered(business['nit']),*wrap(business['address']),*wrap(business['phone']),'-'*width,*centered(d['title']),*centered(d['code']),*wrap(d['created']),*wrap(f"Atendió: {d['operator']}"),'-'*width]
        if d.get('customer'): out += [f"Cliente: {d['customer']['name']}",f"Documento: {d['customer']['document']}"]
        if d.get('lines'): out += pos_product_receipt_lines(d['lines'],width)
        if 'total' in d: out += ['-'*width,row('TOTAL',fmt(d['total']))]
        for p in d.get('payments',[]): out.append(row(f"{p.get('kind','')} {p['method']}",fmt(p['amount'])))
        if kind=='collection': out += [row('Abono',fmt(d['amount'])),*wrap(f"Medio: {d['method']}"),row('Saldo cliente',fmt(d['balance']))]
        if kind=='sale':
            if d.get('cash_received'): out += [row('Efectivo recibido',fmt(d['cash_received'])),row('Cambio entregado',fmt(d['change_given']))]
            out += [row('Saldo fiado',fmt(d['debt']))]
        if kind in ('cash','cash_open'): out += [row('Base',fmt(d['opening'])),row('Efectivo esperado',fmt(d['expected']))]
        out += ['-'*width,*centered('Gracias por su compra'),'','','']; return '\n'.join(out)
    def smtp_send(self,msg):
        host=os.getenv('POS_SMTP_HOST'); require(host,'Configure el correo SMTP en el servidor')
        port=int(os.getenv('POS_SMTP_PORT','587')); security=os.getenv('POS_SMTP_SECURITY','starttls').lower()
        smtp=(smtplib.SMTP_SSL(host,port,timeout=20,context=ssl.create_default_context()) if security=='ssl' else smtplib.SMTP(host,port,timeout=20))
        with smtp:
            if security=='starttls': smtp.starttls(context=ssl.create_default_context())
            if os.getenv('POS_SMTP_USER'): smtp.login(os.environ['POS_SMTP_USER'],os.environ['POS_SMTP_PASSWORD'])
            smtp.send_message(msg)
    def send_test_email(self,recipient):
        msg=EmailMessage(); msg['Subject']='Prueba de correo — Comercio Local'; msg['From']=f"{os.getenv('POS_SMTP_FROM_NAME','Comercio Local')} <{os.environ.get('POS_SMTP_FROM','')}>"; msg['To']=recipient; msg.set_content('La configuración de correo de Comercio Local funciona correctamente.'); self.smtp_send(msg)
    def send_queue(self,u,b):
        require(os.getenv('POS_SMTP_HOST'),'Configure el correo SMTP en el servidor; los mensajes siguen en cola')
        with self.connect() as db: queue=self.rows(db,"SELECT * FROM document_emails WHERE business_id=? AND status IN ('pending','error') ORDER BY id LIMIT 20",(b,))
        sent=0
        for item in queue:
            try:
                msg=EmailMessage(); msg['From']=f"{os.getenv('POS_SMTP_FROM_NAME','Comercio Local')} <{os.environ['POS_SMTP_FROM']}>"; msg['To']=item['recipient']
                if item['kind']=='quote':
                    msg['Subject']='Cotización solicitada — Comercio Local'; msg.set_content('Hola, adjuntamos la cotización solicitada. Quedamos atentos a cualquier inquietud.'); msg.add_attachment(self.quote_pdf(b,item['document_id']),maintype='application',subtype='pdf',filename=f"cotizacion-{item['document_id']:06d}.pdf")
                elif b==2:
                    msg['Subject']='Factura de venta ? Comercio Local'; msg.set_content('Hola, adjuntamos la factura comercial de su compra. Gracias por preferirnos.'); msg.add_attachment(self.invoice_pdf(b,item['document_id']),maintype='application',subtype='pdf',filename=f"factura-ferreteria-{item['document_id']:06d}.pdf")
                else:
                    msg['Subject']='Recibo de venta — Comercio Local'; msg.set_content('Adjuntamos su comprobante interno de venta.'); msg.add_attachment(self.receipt(b,'sale',item['document_id']).encode(),maintype='text',subtype='html',filename=f"recibo-{item['document_id']}.html")
                self.smtp_send(msg)
                status,error='sent',''; sent+=1
            except Exception as ex:
                print('SMTP',type(ex).__name__,str(ex),flush=True); status,error='error','No fue posible enviar. Verifique la configuración del correo.'
            with self.connect() as db: db.execute('UPDATE document_emails SET status=?,error=? WHERE id=?',(status,error,item['id']))
        return {'sent':sent,'attempted':len(queue)}

class Handler(BaseHTTPRequestHandler):
    store:Store
    attempts={}
    def log_message(self,fmt,*args): print('%s %s' % (self.address_string(),fmt%args),flush=True)
    def respond(self,status,payload,ctype='application/json; charset=utf-8',headers=None):
        body=json.dumps(payload,ensure_ascii=False).encode() if ctype.startswith('application/json') else payload if isinstance(payload,bytes) else str(payload).encode()
        self.send_response(status); self.send_header('Content-Type',ctype); self.send_header('Content-Length',str(len(body))); self.send_header('Cache-Control','no-store'); self.send_header('X-Content-Type-Options','nosniff'); self.send_header('X-Frame-Options','SAMEORIGIN'); self.send_header('Referrer-Policy','same-origin')
        for k,v in (headers or {}).items(): self.send_header(k,v)
        self.end_headers(); self.wfile.write(body)
    def do_GET(self): self.handle_request(False)
    def do_POST(self): self.handle_request(True)
    def handle_request(self,post):
        try:
            parsed=urlparse(self.path); path=parsed.path; q=parse_qs(parsed.query)
            if post:
                require(self.headers.get('X-POS-Request')=='1','Solicitud no autorizada')
                origin=self.headers.get('Origin'); require(not origin or urlparse(origin).netloc==self.headers.get('Host'),'Origen no permitido')
                n=int(self.headers.get('Content-Length','0')); require(0<n<=1048576,'Solicitud demasiado grande o vacía'); d=json.loads(self.rfile.read(n))
            else: d={}
            if path=='/api/status' and not post:
                with self.store.connect() as db: setup=not bool(db.execute('SELECT 1 FROM users WHERE active=1').fetchone())
                return self.respond(200,{'setup':setup,'version':'3.3.2'})
            if path=='/api/setup' and post: return self.respond(200,self.store.setup(d))
            if path=='/api/login' and post:
                key=self.client_address[0]; attempts=[x for x in self.attempts.get(key,[]) if x>time.time()-300]; require(len(attempts)<10,'Espere cinco minutos antes de intentar nuevamente'); attempts.append(time.time()); self.attempts[key]=attempts
                token=self.store.login(d); self.attempts[key]=[]; return self.respond(200,{'ok':True},headers={'Set-Cookie':f'pos_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200'})
            cookie=cookies.SimpleCookie(); cookie.load(self.headers.get('Cookie','')); token=cookie.get('pos_session'); token=token.value if token else ''; u=self.store.user(token)
            if path.startswith('/api/') or path in ('/receipt','/receipt.txt','/quote.pdf','/invoice','/invoice.pdf','/dispatch','/dispatch.txt','/labels-preview'):
                if not u: return self.respond(401,{'error':'Inicie sesión para continuar'})
                if path=='/api/logout' and post:
                    with self.store.connect() as db: db.execute('DELETE FROM sessions WHERE token=?',(token,))
                    return self.respond(200,{'ok':True},headers={'Set-Cookie':'pos_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'})
                allowed=json.loads(u['businesses']); b=int(q.get('business',[allowed[0]])[0]); require(b in allowed,'No tiene acceso a este negocio')
                if path=='/api/state' and not post: return self.respond(200,self.store.state(u,b))
                if path=='/api/logistics' and not post: return self.respond(200,logistics_state(self.store,u,b,q.get('search',[''])[0]))
                if path=='/api/dispatch-sale' and not post: return self.respond(200,sale_options(self.store,u,b,int(q['id'][0])))
                if path=='/api/logistics-command' and post: return self.respond(200,logistics_command(self.store,u,b,d['action'],d.get('data',{})))
                if path=='/api/history' and not post: return self.respond(200,self.store.history(u,b,q.get('start',[today()])[0],q.get('end',[today()])[0]))
                if path=='/api/dairy' and not post: require(b==1,'Módulo disponible en mini market'); return self.respond(200,dairy_state(self.store,u,q.get('start',[today()])[0],q.get('end',[today()])[0]))
                if path=='/api/dairy-command' and post: require(b==1,'Módulo disponible en mini market'); return self.respond(200,dairy_command(self.store,u,d['action'],d.get('data',{})))
                if path=='/api/dairy-report.xlsx' and not post:
                    require(b==1,'Módulo disponible en mini market'); start=q.get('start',[today()])[0]; end=q.get('end',[today()])[0]; dairy=dairy_state(self.store,u,start,end)
                    with self.store.connect() as db: business=self.store.one(db,'SELECT * FROM businesses WHERE id=1')
                    columns=['Fecha','Venta','Producto','Cantidad','Unidad','Precio aplicado','Importe','Medio de pago','Usuario','Estado']; items=[[x['created'],x['sale_number'],x['name'],(x['qty']-x['returned_qty'])/1000,x['unit'],x['price'],x['total']-x['returned_amount'],x['payment_methods'],x['operator'],x['status']] for x in dairy['lines']]
                    output=report_xlsx(business,u,'Control de lácteos caseros',start,end,columns,items,(5,6),(6,)); return self.respond(200,output,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',{'Content-Disposition':f'attachment; filename="Lacteos_{start}_{end}.xlsx"'})
                if path=='/api/finance' and not post: return self.respond(200,finance_state(self.store,u,b,q.get('start',['2000-01-01'])[0],q.get('end',['2999-12-31'])[0]))
                if path=='/api/finance-command' and post: return self.respond(200,finance_command(self.store,u,b,d['action'],d.get('data',{})))
                if path=='/api/finance-report.xlsx' and not post:
                    start=q.get('start',['2000-01-01'])[0]; end=q.get('end',['2999-12-31'])[0]; kind=q.get('kind',['movements'])[0]; f=finance_state(self.store,u,b,start,end)
                    with self.store.connect() as db:
                        from finance import permission; permission(db,u,b,'report'); business=self.store.one(db,'SELECT * FROM businesses WHERE id=?',(b,))
                    specs={'movements':('Movimientos financieros',['Fecha','Cuenta','Tipo','Concepto','Entrada','Salida','Saldo','Usuario'],[[x['effective_date'],x['account'],x['kind'],x['concept'],x['amount'] if x['direction']>0 else 0,x['amount'] if x['direction']<0 else 0,x['balance_after'],x['operator']] for x in f['movements']],(4,5,6)),'invoices':('Facturas de compra',['Fecha','Factura','Proveedor','Descripción','Total','Pagado','Saldo','Estado'],[[x['invoice_date'],x['number'],x['supplier'],x['description'],x['total'],x['paid'],x['total']-x['paid'],x['status']] for x in f['invoices']],(4,5,6)),'payroll':('Nómina',['Período','Empleado','Neto','Pagado','Saldo','Estado'],[[x['period'],x['employee'],x['net_total'],x['paid'],x['net_total']-x['paid'],x['status']] for x in f['payrolls']],(2,3,4)),'profits':('Utilidades',['Período','Utilidad','Fondo','Reinversión','Disponible','Restante'],[[x['period'],x['profit'],x['distribution_fund'],x['reinvestment'],x['available_distribution'],x['remaining_profit']] for x in f['profits']],(1,2,3,4,5))}
                    require(kind in specs,'Reporte financiero inválido'); title,columns,items,money_columns=specs[kind]; output=report_xlsx(business,u,title,start,end,columns,items,money_columns,money_columns)
                    return self.respond(200,output,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',{'Content-Disposition':f'attachment; filename="Contabilidad_{kind}_{b}.xlsx"'})
                if path=='/api/analytics' and not post: return self.respond(200,self.store.analytics(u,b,q.get('start',[today()])[0],q.get('end',[today()])[0]))
                if path=='/api/quote' and not post:
                    with self.store.connect() as db: result=self.store.scoped(db,'quotes',int(q['id'][0]),b)
                    result['lines']=json.loads(result['lines']); return self.respond(200,result)
                if path=='/api/sale-return-options' and not post:
                    with self.store.connect() as db:
                        result=self.store.scoped(db,'sales',int(q['id'][0]),b)
                        lines=self.store.rows(db,'SELECT l.*,COALESCE((SELECT SUM(sr.qty) FROM sales_return_lines sr WHERE sr.sale_line_id=l.id),0) returned_qty FROM sale_lines l WHERE l.sale_id=? ORDER BY l.id',(result['id'],))
                    result['lines']=[line for line in lines if line['returned_qty']<line['qty']]
                    return self.respond(200,result)
                if path=='/api/command' and post: return self.respond(200,self.store.command(u,b,d['action'],d.get('data',{})))
                if path=='/api/send-emails' and post: return self.respond(200,self.store.send_queue(u,b))
                if path=='/receipt' and not post: return self.respond(200,self.store.receipt(b,q['kind'][0],int(q['id'][0])),'text/html; charset=utf-8')
                if path=='/receipt.txt' and not post: return self.respond(200,self.store.receipt_text(b,q['kind'][0],int(q['id'][0])),'text/plain; charset=utf-8')
                if path=='/dispatch' and not post: return self.respond(200,dispatch_receipt(self.store,b,int(q['id'][0])),'text/html; charset=utf-8')
                if path=='/dispatch.txt' and not post: return self.respond(200,dispatch_receipt(self.store,b,int(q['id'][0]),True),'text/plain; charset=utf-8')
                if path=='/labels-preview' and post: return self.respond(200,labels_html(self.store,b,d),'text/html; charset=utf-8')
                if path=='/quote.pdf' and not post:
                    data=self.store.quote_pdf(b,int(q['id'][0])); return self.respond(200,data,'application/pdf',{'Content-Disposition':f'attachment; filename="cotizacion-{int(q["id"][0]):06d}.pdf"'})
                if path=='/invoice' and not post:
                    return self.respond(200,self.store.invoice(b,int(q['id'][0])),'text/html; charset=utf-8')
                if path=='/invoice.pdf' and not post:
                    invoice_id=int(q['id'][0]); data=self.store.invoice_pdf(b,invoice_id)
                    return self.respond(200,data,'application/pdf',{'Content-Disposition':f'attachment; filename="factura-ferreteria-{invoice_id:06d}.pdf"'})
                if path=='/api/backup' and not post:
                    self.store.admin(u); target=self.store.path.parent/'backups'; target.mkdir(exist_ok=True); file=target/f'comercio-{datetime.now().strftime("%Y%m%d-%H%M%S")}-{secrets.token_hex(3)}.sqlite3'
                    with self.store.connect() as src,closing(sqlite3.connect(file)) as dest: src.backup(dest)
                    return self.respond(200,file.read_bytes(),'application/octet-stream',{'Content-Disposition':f'attachment; filename="{file.name}"'})
                if path=='/api/inventory.xlsx' and not post:
                    category=clean(q.get('category',[''])[0]); status=clean(q.get('status',[''])[0]); search=clean(q.get('search',[''])[0]); in_stock=q.get('in_stock',['0'])[0]=='1'
                    business,items=self.store.inventory_report(u,b,category,status,search,in_stock); filters='; '.join(x for x in [f'Categoría: {category}' if category else '',f'Estado: {status}' if status else '',f'Producto: {search}' if search else '','Solo con existencia' if in_stock else ''] if x)
                    data=inventory_xlsx(business,u,items,filters); name=re.sub(r'[^A-Za-z0-9]+','_',business['name']).strip('_')
                    return self.respond(200,data,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',{'Content-Disposition':f'attachment; filename="Inventario_Disponible_{name}_{today()}.xlsx"'})
                if path=='/api/report.xlsx' and not post:
                    start=q.get('start',[today()])[0]; end=q.get('end',[today()])[0]; kind=clean(q.get('kind',['ventas'])[0]); business,title,columns,rows,money_cols,totals=self.store.report_rows(u,b,kind,start,end); data=report_xlsx(business,u,title,start,end,columns,rows,money_cols,totals); name=re.sub(r'[^A-Za-z0-9]+','_',business['name']).strip('_')
                    return self.respond(200,data,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',{'Content-Disposition':f'attachment; filename="{kind.title()}_{name}_{start}_{end}.xlsx"'})
                if path=='/api/export' and not post:
                    self.store.admin(u); kind=q.get('kind',['sales'])[0]; require(kind in ('sales','stock_moves','payments','top','debts','cash_moves','audit'),'Reporte inválido'); data=self.store.history(u,b,q.get('start',[today()])[0],q.get('end',[today()])[0])[kind]
                    out=io.StringIO(); writer=csv.writer(out,delimiter=';')
                    if data:
                        labels={'id':'ID','number':'Número','created':'Fecha','customer':'Cliente','operator':'Vendedor','total':'Total','cost':'Costo','debt':'Saldo pendiente','status':'Estado','due':'Vencimiento','name':'Producto','unit':'Unidad','qty':'Cantidad','margin':'Utilidad bruta','method':'Método de pago','kind':'Tipo de movimiento','amount':'Valor','reference':'Documento / referencia','supplier':'Proveedor','action':'Acción','detail':'Detalle','reason':'Motivo','balance_after':'Existencia después','note':'Observación','cash_id':'Caja'}
                        writer.writerow([labels.get(k,k.replace('_',' ').capitalize()) for k in data[0].keys()])
                        for row in data:
                            writer.writerow([("'"+v if isinstance(v,str) and v.startswith(('=','+','-','@','\t','\r')) else v) for v in row.values()])
                    return self.respond(200,('\ufeff'+out.getvalue()).encode('utf-8'),'text/csv; charset=utf-8',{'Content-Disposition':f'attachment; filename="{kind}-{b}.csv"'})
                return self.respond(404,{'error':'Ruta no encontrada'})
            require(not post,'Ruta inválida')
            if path.startswith('/images/'):
                image_root=(ROOT/'public'/'images').resolve(); file=(image_root/path.removeprefix('/images/')).resolve()
                require(file.is_relative_to(image_root) and file.suffix.lower() in ('.jpg','.jpeg','.png','.webp','.svg') and file.is_file(),'Imagen no encontrada')
                return self.respond(200,file.read_bytes(),{'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.svg':'image/svg+xml'}[file.suffix.lower()])
            files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css','/favicon.svg':'favicon.svg','/sw.js':'sw.js','/manifest.webmanifest':'manifest.webmanifest'}
            if path not in files: return self.respond(404,'No encontrado','text/plain')
            file=ROOT/'public'/files[path]; ctype={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'}[file.suffix]
            return self.respond(200,file.read_bytes(),ctype)
        except (ValueError,KeyError,TypeError,sqlite3.IntegrityError) as ex:
            msg='Referencia o código duplicado, o dato que incumple una restricción' if isinstance(ex,sqlite3.IntegrityError) else str(ex)
            self.respond(400,{'error':msg})
        except Exception as ex:
            print(type(ex).__name__,str(ex),flush=True); self.respond(500,{'error':'No fue posible completar la operación. Los cambios no confirmados se revierten.'})

def main():
    parser=argparse.ArgumentParser(); parser.add_argument('--port',type=int,default=8765); parser.add_argument('--host',default='127.0.0.1'); parser.add_argument('--data',default=str(ROOT/'data'/'comercio.sqlite3')); args=parser.parse_args()
    Handler.store=Store(args.data); server=ThreadingHTTPServer((args.host,args.port),Handler)
    print(f'Comercio Local: http://{args.host}:{args.port}',flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()
if __name__=='__main__': main()
