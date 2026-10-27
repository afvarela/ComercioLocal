import sys, unittest, uuid
import io, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import Store, today, date, timedelta, quantity, money
from excel_report import inventory_xlsx, report_xlsx

class CommerceTests(unittest.TestCase):
    def setUp(self):
        self.path=Path(__file__).parent/f'.test-{uuid.uuid4().hex}.sqlite3'; self.store=Store(self.path,seed_catalog=False)
        self.store.setup({'username':'admin','name':'Pruebas','password':'1234'})
        self.u=self.store.user(self.store.login({'username':'admin','password':'1234'}))
        self.run_cmd('open_cash',{'opening':100000})
    def tearDown(self):
        for suffix in ('','-wal','-shm'):
            try: Path(str(self.path)+suffix).unlink(missing_ok=True)
            except PermissionError: pass
    def run_cmd(self,action,data,b=1,user=None): return self.store.command(user or self.u,b,action,data)
    def product(self,name='Arroz',unit='und',price=5000,b=1):
        return self.run_cmd('product',{'sku':uuid.uuid4().hex,'name':name,'unit':unit,'price':price},b)['id']
    def lot(self,p,qty=10,cost=3000,expiry=None,b=1):
        return self.run_cmd('receive',{'product_id':p,'code':uuid.uuid4().hex,'supplier':'Proveedor','qty':qty,'cost':cost,'expires':expiry},b)['id']
    def sale(self,p,qty=1,pay=5000,**extra):
        return self.run_cmd('sale',{'request_id':uuid.uuid4().hex,'lines':[{'product_id':p,'qty':qty}],'payments':[{'method':'Efectivo','amount':pay}],**extra})
    def test_split_payment_change_and_cash(self):
        p=self.product();self.lot(p)
        r=self.sale(p,qty=2,payments=[{'method':'Nequi','amount':4000},{'method':'Efectivo','amount':10000}])
        self.assertEqual(r['change'],400000)
        state=self.store.state(self.u,1); self.assertEqual(state['products'][0]['available'],8);self.assertEqual(state['cash']['expected'],10600000)
        html=self.store.receipt(1,'sale',r['id']); self.assertIn('MM-000001',html);self.assertIn('Nequi',html)
        self.assertIn('Efectivo recibido',html); self.assertIn('Cambio entregado',html)
        with self.store.connect() as db:
            saved=db.execute('SELECT cash_received,change_given FROM sales WHERE id=?',(r['id'],)).fetchone()
            self.assertEqual(saved['cash_received'],1000000); self.assertEqual(saved['change_given'],400000)
        methods=self.store.history(self.u,1,today(),today())['sales'][0]['payment_methods'];self.assertIn('Efectivo: 6000.00',methods);self.assertIn('Nequi: 4000.00',methods)
    def test_atomic_insufficient_stock(self):
        p=self.product();self.lot(p,1)
        with self.assertRaises(ValueError):self.sale(p,2,10000)
        self.assertEqual(self.store.state(self.u,1)['products'][0]['available'],1)
        self.assertEqual(self.store.history(self.u,1,today(),today())['sales'],[])
    def test_vegetable_receipt_does_not_require_lot_supplier_or_expiry(self):
        p=self.run_cmd('product',{'sku':'VER-TEST','name':'Verdura prueba','category':'Verduras','unit':'g','price':4000,'price_basis':500,'perishable':True})['id']
        result=self.run_cmd('receive',{'product_id':p,'qty':1000,'cost':2000,'sale_price':5500})
        self.assertTrue(result['id'])
        with self.store.connect() as db:
            lot=db.execute('SELECT * FROM lots WHERE id=?',(result['id'],)).fetchone()
            self.assertTrue(lot['code'].startswith('AUTO-')); self.assertEqual(lot['supplier'],'Sin proveedor'); self.assertIsNone(lot['expires'])
            self.assertEqual(db.execute('SELECT price FROM products WHERE id=?',(p,)).fetchone()['price'],550000)
    def test_fefo_and_expired_blocked(self):
        p=self.product('Tomate','g',6000)
        late=self.lot(p,1000,2000,(date.today()+timedelta(days=10)).isoformat())
        early=self.lot(p,200,1000,(date.today()+timedelta(days=2)).isoformat())
        expired=self.lot(p,100,1000)
        with self.store.connect() as db: db.execute('UPDATE lots SET expires=? WHERE id=?',((date.today()-timedelta(days=1)).isoformat(),expired))
        r=self.sale(p,350,2100)
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT qty FROM lots WHERE id=?',(early,)).fetchone()[0],0)
            self.assertEqual(db.execute('SELECT qty FROM lots WHERE id=?',(late,)).fetchone()[0],850)
            self.assertEqual(db.execute('SELECT qty FROM lots WHERE id=?',(expired,)).fetchone()[0],100)
            self.assertEqual(db.execute('SELECT total FROM sales WHERE id=?',(r['id'],)).fetchone()[0],210000)
        with self.assertRaises(ValueError): self.sale(p,851,6000)

    def test_initial_stock_is_quick_visible_by_lot_and_sold_first(self):
        p=self.product('Aceite vegetal',price=9000)
        initial=self.run_cmd('initial_stock',{'product_id':p,'qty':7,'cost':6000,'note':'Inventario al abrir'})['id']
        regular=self.lot(p,5,6500)
        state=self.store.state(self.u,1)
        lots={x['id']:x for x in state['lots']}
        self.assertTrue(lots[initial]['code'].startswith('INICIAL-'))
        self.assertEqual(lots[initial]['qty'],7)
        self.assertEqual(lots[regular]['qty'],5)
        self.sale(p,8,72000)
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT qty FROM lots WHERE id=?',(initial,)).fetchone()[0],0)
            self.assertEqual(db.execute('SELECT qty FROM lots WHERE id=?',(regular,)).fetchone()[0],4)
        hardware=self.product('Aceite lubricante',price=9000,b=2)
        with self.assertRaises(ValueError):
            self.run_cmd('initial_stock',{'product_id':hardware,'qty':2,'cost':5000},2)
    def test_credit_limit_and_repayments(self):
        p=self.product();self.lot(p)
        c=self.run_cmd('customer',{'name':'Ana','credit_limit':10000})['id']
        s=self.sale(p,2,3000,customer_id=c,allow_credit=True,due=today())
        self.assertEqual(self.store.state(self.u,1)['customers'][0]['balance'],700000)
        with self.assertRaises(ValueError):self.sale(p,1,0,customer_id=c,allow_credit=True,due=today())
        r=self.run_cmd('repay',{'sale_id':s['id'],'amount':2000,'method':'Nequi'})
        self.assertEqual(self.store.state(self.u,1)['customers'][0]['balance'],500000)
        with self.store.connect() as db:
            account=db.execute('SELECT original_amount,paid_amount,balance,status FROM receivables WHERE sale_id=?',(s['id'],)).fetchone()
            self.assertEqual(tuple(account),(700000,200000,500000,'Parcialmente pagado'))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM receivable_moves WHERE sale_id=?',(s['id'],)).fetchone()[0],2)
        self.assertIn('Recibo de abono',self.store.receipt(1,'payment',r['id']))
        with self.assertRaises(ValueError): self.run_cmd('repay',{'sale_id':s['id'],'amount':6000,'method':'Efectivo'})
        self.assertEqual(self.store.state(self.u,1)['cash']['expected'],10300000)
    def test_business_separation_and_quote(self):
        p=self.product();self.lot(p)
        h=self.product('Tornillo',price=1000,b=2);self.lot(h,10,500,b=2)
        with self.assertRaises(ValueError): self.sale(h,1,1000)
        self.assertEqual(len(self.store.state(self.u,1)['products']),1)
        q=self.run_cmd('quote',{'lines':[{'product_id':h,'qty':2}],'valid_until':today()},2)
        self.assertTrue(self.store.quote_pdf(2,q['id']).startswith(b'%PDF-'))
        self.assertEqual(self.store.state(self.u,2)['products'][0]['available'],10)
        self.run_cmd('open_cash',{'opening':0},2)
        payload={'request_id':uuid.uuid4().hex,'lines':[{'product_id':h,'qty':2}],'payments':[{'method':'Efectivo','amount':2000}],'quote_id':q['id']}
        s=self.run_cmd('sale',payload,2)
        payload['request_id']=uuid.uuid4().hex
        with self.assertRaises(ValueError): self.run_cmd('sale',payload,2)
        self.assertIn('FE-000001',self.store.receipt(2,'sale',s['id']))
        invoice=self.store.invoice(2,s['id'])
        self.assertIn('FACTURA DE VENTA',invoice)
        self.assertIn('Tornillo',invoice)
        self.assertIn('NIT:',invoice)
        self.assertIn('/invoice.pdf?business=2',invoice)
        pdf=self.store.invoice_pdf(2,s['id'])
        self.assertTrue(pdf.startswith(b'%PDF-'))
        self.assertIn(b'/MediaBox',pdf)
        with self.assertRaises(ValueError): self.store.invoice(1,s['id'])
        self.assertEqual(self.store.history(self.u,1,today(),today())['sales'],[])
    def test_sale_retry_is_idempotent(self):
        p=self.product();self.lot(p)
        d={'request_id':uuid.uuid4().hex,'lines':[{'product_id':p,'qty':1}],'payments':[{'method':'Efectivo','amount':5000}]}
        one=self.run_cmd('sale',d); two=self.run_cmd('sale',d)
        self.assertEqual(one['id'],two['id']);self.assertEqual(self.store.state(self.u,1)['products'][0]['available'],9)
    def test_void_reverses_stock_cash_and_debt(self):
        p=self.product();self.lot(p)
        c=self.run_cmd('customer',{'name':'Juan','credit_limit':10000})['id']
        s=self.sale(p,1,3000,customer_id=c,allow_credit=True,due=today())
        self.run_cmd('void_sale',{'sale_id':s['id'],'reason':'Error de digitación'})
        state=self.store.state(self.u,1);self.assertEqual(state['customers'][0]['balance'],0);self.assertEqual(state['products'][0]['available'],10);self.assertEqual(state['cash']['expected'],10000000)
    def test_cash_close_difference_and_no_sale_after_close(self):
        p=self.product();self.lot(p)
        self.run_cmd('cash_move',{'amount':1000,'direction':'out','reason':'Gasto'})
        with self.assertRaises(ValueError):self.run_cmd('close_cash',{'counted':98000})
        r=self.run_cmd('close_cash',{'counted':98000,'note':'Faltante contado','difference_reason':'Error de conteo'})
        self.assertIn('Cierre de caja',self.store.receipt(1,'cash',r['id']))
        with self.assertRaises(ValueError):self.sale(p)
    def test_permissions_and_no_overpaid_transfer(self):
        self.run_cmd('user',{'username':'cajero','name':'Caja','password':'5678','role':'cashier','businesses':[1]})
        u=self.store.user(self.store.login({'username':'cajero','password':'5678'}))
        with self.assertRaises(ValueError):self.run_cmd('product',{'sku':'x','name':'x','unit':'und','price':1},user=u)

    def test_admin_can_disable_and_restore_user_without_losing_history(self):
        created=self.run_cmd('user',{'username':'temporal','name':'Temporal','password':'5678','role':'cashier','businesses':[1],'active':True,'finance_1_view':'on'})
        token=self.store.login({'username':'temporal','password':'5678'})
        self.assertIsNotNone(self.store.user(token))
        self.run_cmd('user',{'id':created['id'],'username':'temporal','name':'Temporal','role':'cashier','businesses':[1],'active':False,'finance_1_view':'on'})
        self.assertIsNone(self.store.user(token))
        with self.assertRaises(ValueError): self.store.login({'username':'temporal','password':'5678'})
        self.run_cmd('user',{'id':created['id'],'username':'temporal','name':'Temporal','role':'cashier','businesses':[1],'active':True,'finance_1_view':'on'})
        self.assertTrue(self.store.login({'username':'temporal','password':'5678'}))
        p=self.product();self.lot(p)
        with self.assertRaises(ValueError):self.sale(p,payments=[{'method':'Nequi','amount':6000}])
    def test_duplicate_lines_cannot_oversell(self):
        p=self.product();self.lot(p,1)
        with self.assertRaises(ValueError):self.sale(p,lines=[{'product_id':p,'qty':1},{'product_id':p,'qty':1}],pay=10000)
    def test_quantities_and_money(self):
        self.assertEqual(quantity('1.001','m'),1001)
        self.assertEqual(money('0.105'),11)
        for bad in ['NaN','Infinity','-1']:
            with self.assertRaises(ValueError):money(bad)
        with self.assertRaises(ValueError):quantity('0.5','g')

    def test_libra_price_and_cost_are_converted_by_500_grams(self):
        p=self.run_cmd('product',{'sku':'VER-LB','name':'Cebolla','unit':'g','price':2000,'price_basis':500})['id']
        self.lot(p,1000,1000)
        sale=self.sale(p,250,1000)
        with self.store.connect() as db:
            s=db.execute('SELECT total,cost FROM sales WHERE id=?',(sale['id'],)).fetchone()
            self.assertEqual(s['total'],100000);self.assertEqual(s['cost'],50000)
        self.assertIn('libra (500 g)',self.store.receipt(1,'sale',sale['id']))

    def test_price_base_change_does_not_reprice_old_lot_cost(self):
        p=self.product('Zanahoria','g',4000);self.lot(p,1000,2000)
        with self.store.connect() as db: product=dict(db.execute('SELECT * FROM products WHERE id=?',(p,)).fetchone())
        self.run_cmd('product',{'id':p,'sku':product['sku'],'name':'Zanahoria','unit':'g','price':2000,'price_basis':500})
        sale=self.sale(p,250,1000)
        with self.store.connect() as db: self.assertEqual(db.execute('SELECT cost FROM sales WHERE id=?',(sale['id'],)).fetchone()[0],50000)

    def test_moving_average_cost_keeps_purchase_history(self):
        p=self.product(price=20000)
        self.lot(p,10,10000)
        self.lot(p,5,14000)
        with self.store.connect() as db:
            product=db.execute('SELECT current_cost FROM products WHERE id=?',(p,)).fetchone()
            self.assertEqual(product['current_cost'],1133333)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM purchases WHERE business_id=1').fetchone()[0],2)
            self.assertEqual([r[0] for r in db.execute('SELECT cost FROM purchase_lines ORDER BY id')],[1000000,1400000])

    def test_cash_uses_exact_cents_with_credit_and_mixed_payments(self):
        p=self.product(price=10.50);self.lot(p,3,5.00)
        c=self.run_cmd('customer',{'name':'Crédito','credit_limit':100})['id']
        self.sale(p,1,5.25,customer_id=c,allow_credit=True,due=today())
        self.sale(p,1,payments=[{'method':'Efectivo','amount':2.25},{'method':'Nequi','amount':8.25}])
        self.assertEqual(self.store.state(self.u,1)['cash']['expected'],10000750)

    def test_sale_return_exposes_invoice_lines_and_restocks(self):
        p=self.product();self.lot(p,3)
        sale=self.sale(p,1,5000)
        history=self.store.history(self.u,1,today(),today())
        lines=[line for line in history['sale_lines'] if line['sale_id']==sale['id']]
        self.assertEqual(len(lines),1)
        self.run_cmd('sale_return',{'sale_line_id':lines[0]['id'],'qty':1,'method':'Efectivo','restock':'1','reason':'Producto cambiado','request_id':uuid.uuid4().hex})
        self.assertEqual(self.store.state(self.u,1)['products'][0]['available'],3)
        self.assertEqual(self.store.state(self.u,1)['cash']['expected'],10000000)
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM sales_returns WHERE sale_id=?',(sale['id'],)).fetchone()[0],1)

    def test_customer_payment_allocates_oldest_invoices(self):
        p=self.product();self.lot(p,5);c=self.run_cmd('customer',{'name':'Cliente cartera','credit_limit':100000})['id']
        first=self.sale(p,1,0,customer_id=c,allow_credit=True,due=today())
        second=self.sale(p,1,0,customer_id=c,allow_credit=True,due=today())
        payment=self.run_cmd('customer_payment',{'customer_id':c,'amount':7500,'method':'Nequi','request_id':uuid.uuid4().hex})
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT debt FROM sales WHERE id=?',(first['id'],)).fetchone()[0],0)
            self.assertEqual(db.execute('SELECT debt FROM sales WHERE id=?',(second['id'],)).fetchone()[0],250000)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM collection_allocations WHERE collection_id=?',(payment['id'],)).fetchone()[0],2)
        self.assertIn('Factura #1',self.store.receipt(1,'collection',payment['id']))

    def test_cash_difference_requires_classification(self):
        with self.assertRaises(ValueError): self.run_cmd('close_cash',{'counted':99999})
        closed=self.run_cmd('close_cash',{'counted':99999,'difference_reason':'Error de conteo'})
        self.assertEqual(closed['difference'],-100)
        with self.store.connect() as db:
            row=db.execute('SELECT difference,difference_type,difference_reason FROM cash_sessions WHERE id=?',(closed['id'],)).fetchone()
            self.assertEqual(tuple(row),(-100,'Faltante','Error de conteo'))

    def test_unregistered_line_is_sold_without_stock(self):
        result=self.run_cmd('sale',{'request_id':uuid.uuid4().hex,'lines':[],'unregistered_lines':[{'description':'Servicio de corte','qty':2,'price':3000,'discount':500}],'payments':[{'method':'Efectivo','amount':5500}]})
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT total FROM sales WHERE id=?',(result['id'],)).fetchone()[0],550000)
            self.assertEqual(db.execute('SELECT total FROM unregistered_sale_lines WHERE sale_id=?',(result['id'],)).fetchone()[0],550000)
        self.assertIn('Servicio de corte',self.store.receipt(1,'sale',result['id']))

    def test_analytics_returns_business_indicators(self):
        p=self.product();self.lot(p);self.sale(p)
        report=self.store.analytics(self.u,1,today(),today())
        self.assertEqual(report['summary']['transactions'],1)
        self.assertEqual(report['summary']['sales'],500000)
        self.assertTrue(report['rotation'])

    def test_inventory_available_xlsx_is_valid_and_scoped(self):
        p=self.product();self.lot(p,4,3000)
        business,items=self.store.inventory_report(self.u,1)
        data=inventory_xlsx(business,self.u,items,'Todos')
        self.assertTrue(data.startswith(b'PK'))
        with zipfile.ZipFile(io.BytesIO(data)) as book:
            self.assertIn('xl/worksheets/sheet2.xml',book.namelist())
            for name in [x for x in book.namelist() if x.endswith('.xml')]: ET.fromstring(book.read(name))
            detail=book.read('xl/worksheets/sheet2.xml').decode('utf-8')
            self.assertIn('Arroz',detail);self.assertIn('Valor potencial de venta',detail)
        _,hardware=self.store.inventory_report(self.u,2)
        self.assertFalse(any(x['name']=='Arroz' for x in hardware))

    def test_every_management_report_can_generate_real_xlsx(self):
        p=self.product();self.lot(p);self.sale(p)
        for kind in ('ventas','recaudos','cartera','kardex','caja','auditoria'):
            business,title,headers,rows,money_cols,totals=self.store.report_rows(self.u,1,kind,today(),today())
            data=report_xlsx(business,self.u,title,today(),today(),headers,rows,money_cols,totals)
            with zipfile.ZipFile(io.BytesIO(data)) as book:
                ET.fromstring(book.read('xl/worksheets/sheet1.xml'))

    def test_quote_accepts_fixed_unregistered_product(self):
        q=self.run_cmd('quote',{'lines':[],'unregistered_lines':[{'qty':2,'price':1250}],'valid_until':today()},2)
        with self.store.connect() as db:
            saved=db.execute('SELECT lines,total FROM quotes WHERE id=?',(q['id'],)).fetchone()
            self.assertIn('Producto no registrado',saved['lines']);self.assertEqual(saved['total'],250000)

if __name__=='__main__': unittest.main(verbosity=2)
