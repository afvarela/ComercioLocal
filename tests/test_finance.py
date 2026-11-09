import sys, unittest, uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import Store, today
from finance import finance_state, finance_command

class FinanceTests(unittest.TestCase):
    def setUp(self):
        self.path=Path(__file__).parent/f'.finance-{uuid.uuid4().hex}.sqlite3'
        self.store=Store(self.path,seed_catalog=False)
        self.store.setup({'username':'admin','name':'Administrador','password':'1234'})
        self.user=self.store.user(self.store.login({'username':'admin','password':'1234'}))
        for account in (101,102,103,201,202,203):
            finance_command(self.store,self.user,1 if account<200 else 2,'account_adjust',{'account_id':account,'amount':2000000,'date':today(),'request_id':uuid.uuid4().hex})
    def tearDown(self):
        for suffix in ('','-wal','-shm'):
            Path(str(self.path)+suffix).unlink(missing_ok=True)
    def cmd(self,action,data,b=1):
        data.setdefault('request_id',uuid.uuid4().hex); return finance_command(self.store,self.user,b,action,data)

    def test_invoice_split_and_partial_payment(self):
        inv=self.cmd('invoice_create',{'invoice_date':today(),'description':'Verduras','total':500000,'payments':[{'account_id':101,'amount':200000},{'account_id':102,'amount':100000},{'account_id':103,'amount':100000}]})['id']
        state=finance_state(self.store,self.user,1); invoice=next(x for x in state['invoices'] if x['id']==inv)
        self.assertEqual(invoice['paid'],40000000); self.assertEqual(invoice['total']-invoice['paid'],10000000)
        self.cmd('invoice_pay',{'invoice_id':inv,'account_id':103,'amount':100000,'date':today()})
        invoice=finance_state(self.store,self.user,1)['invoices'][0]; self.assertEqual(invoice['status'],'paid')
        with self.assertRaises(ValueError): self.cmd('invoice_pay',{'invoice_id':inv,'account_id':103,'amount':1,'date':today()})

    def test_invoice_payment_does_not_require_account_balance(self):
        before=next(x for x in finance_state(self.store,self.user,1)['accounts'] if x['name']=='Nequi')['balance']
        inv=self.cmd('invoice_create',{'invoice_date':today(),'description':'Factura independiente','total':2500000,'payments':[{'account_id':102,'amount':2500000}]})['id']
        state=finance_state(self.store,self.user,1)
        invoice=next(x for x in state['invoices'] if x['id']==inv)
        nequi=next(x for x in state['accounts'] if x['name']=='Nequi')
        self.assertEqual(invoice['status'],'paid')
        self.assertEqual(nequi['balance'],before-250000000)
        self.assertLess(nequi['balance'],0)

    def test_closed_cash_sales_enter_bank_once_by_payment_method(self):
        before={x['name']:x['balance'] for x in finance_state(self.store,self.user,1)['accounts']}
        with self.store.connect() as db:
            cash=db.execute("INSERT INTO cash_sessions(business_id,user_id,opened,opening,closed,counted,expected,note,closed_by) VALUES(1,?,?,?,?,?,?,?,?)",(self.user['id'],'2026-11-05T08:00:00-05:00',0,'2026-11-05T20:00:00-05:00',100000,100000,'',self.user['id'])).lastrowid
            sale=db.execute("INSERT INTO sales(business_id,number,user_id,cash_id,created,total,cost,debt,request_id) VALUES(1,1,?,?,?,600000,0,0,?)",(self.user['id'],cash,'2026-11-05T10:00:00-05:00',uuid.uuid4().hex)).lastrowid
            values=[('Efectivo',120000,'Venta'),('Efectivo',-20000,'Devolución'),('Nequi',200000,'Venta'),('Bancolombia',300000,'Venta'),('Nequi',50000,'Abono')]
            for method,amount,kind in values: db.execute('INSERT INTO payments(business_id,sale_id,cash_id,user_id,created,method,amount,kind) VALUES(1,?,?,?,?,?,?,?)',(sale,cash,self.user['id'],'2026-11-05T10:00:00-05:00',method,amount,kind))
        first=finance_state(self.store,self.user,1); second=finance_state(self.store,self.user,1)
        balances={x['name']:x['balance'] for x in second['accounts']}
        self.assertEqual((balances['Efectivo']-before['Efectivo'],balances['Nequi']-before['Nequi'],balances['Bancolombia']-before['Bancolombia']),(100000,200000,300000))
        self.assertEqual(len(second['bank_closures']),1)
        self.assertEqual((second['bank_closures'][0]['efectivo'],second['bank_closures'][0]['nequi'],second['bank_closures'][0]['bancolombia'],second['bank_closures'][0]['total']),(100000,200000,300000,600000))
        self.assertEqual((second['bank']['Efectivo']['balance'],second['bank']['Nequi']['balance'],second['bank']['Bancolombia']['balance'],second['bank']['total']),(100000,200000,300000,600000))
        self.assertEqual(len([x for x in second['movements'] if x['source_type']=='cash_close']),3)
        self.assertEqual(len(first['bank_closures']),len(second['bank_closures']))

    def test_invoice_can_be_edited_and_paid_with_multiple_bank_methods(self):
        before={x['name']:x['balance'] for x in finance_state(self.store,self.user,1)['accounts']}
        invoice=self.cmd('invoice_create',{'invoice_date':today(),'number':'FC-1','description':'Compra inicial','total':1000,'payments':[{'account_id':101,'amount':400}]})['id']
        self.cmd('invoice_edit',{'invoice_id':invoice,'invoice_date':today(),'number':'FC-1-A','description':'Compra corregida','total':1500,'supplier':'Proveedor','payments':[{'account_id':102,'amount':500},{'account_id':103,'amount':750}]})
        state=finance_state(self.store,self.user,1); item=next(x for x in state['invoices'] if x['id']==invoice); balances={x['name']:x['balance'] for x in state['accounts']}
        self.assertEqual((item['number'],item['description'],item['total'],item['paid'],item['status']),('FC-1-A','Compra corregida',150000,125000,'partial'))
        self.assertEqual({x['account']:x['amount'] for x in item['payments']},{'Nequi':50000,'Bancolombia':75000})
        self.assertEqual(balances['Efectivo'],before['Efectivo'])
        self.assertEqual(balances['Nequi'],before['Nequi']-50000)
        self.assertEqual(balances['Bancolombia'],before['Bancolombia']-75000)
        self.cmd('invoice_pay',{'invoice_id':invoice,'date':today(),'payments':[{'account_id':101,'amount':100},{'account_id':102,'amount':150}]})
        paid=next(x for x in finance_state(self.store,self.user,1)['invoices'] if x['id']==invoice)
        self.assertEqual((paid['paid'],paid['status']),(150000,'paid'))
        with self.store.connect() as db: self.assertEqual(db.execute("SELECT COUNT(*) FROM finance_invoice_payments WHERE invoice_id=? AND status='void'",(invoice,)).fetchone()[0],1)

    def test_profit_values_are_independent_from_profit_and_sales(self):
        profit=self.cmd('profit_create',{'period':'2026-11','profit':1000000,'date':today(),'allocations':[{'account_id':102,'amount':125000}]})['id']
        self.cmd('profit_fund',{'profit_id':profit,'date':today(),'allocations':[{'account_id':102,'amount':25000},{'account_id':103,'amount':50000}]})
        item=next(x for x in finance_state(self.store,self.user,1)['profits'] if x['id']==profit)
        self.assertEqual(item['profit'],100000000)
        self.assertEqual(item['funded'],20000000)

    def test_payroll_profit_distribution_and_reinvestment(self):
        employee=self.cmd('employee_create',{'name':'Ana','document':'1','salary':1300000,'started':today()})['id']
        payroll=self.cmd('payroll_create',{'employee_id':employee,'period':'2026-09','days_worked':30,'base_salary':1300000,'bonuses':100000,'deductions':50000})['id']
        self.cmd('payroll_pay',{'payroll_id':payroll,'account_id':103,'amount':675000,'date':today()})
        self.cmd('payroll_pay',{'payroll_id':payroll,'account_id':102,'amount':675000,'date':today()})
        before_profit={x['name']:x['balance'] for x in finance_state(self.store,self.user,1)['accounts']}
        profit=self.cmd('profit_create',{'period':'2026-09','profit':1000000,'date':today(),'allocations':[{'account_id':101,'amount':200000},{'account_id':102,'amount':300000},{'account_id':103,'amount':500000}]})['id']
        funded=finance_state(self.store,self.user,1)
        p=funded['profits'][0]
        self.assertEqual((p['distribution_fund'],p['reinvestment'],p['available_distribution'],p['remaining_profit']),(30000000,5100000,24900000,70000000))
        balances={x['name']:x['balance'] for x in funded['accounts']}
        self.assertEqual(balances['Efectivo']-before_profit['Efectivo'],20000000)
        self.assertEqual(balances['Nequi']-before_profit['Nequi'],30000000)
        self.assertEqual(balances['Bancolombia']-before_profit['Bancolombia'],50000000)
        self.assertEqual(p['funded'],p['profit'])
        self.cmd('profit_create',{'period':'2026-10','profit':1568627,'date':today(),'allocations':[{'account_id':101,'amount':568627},{'account_id':102,'amount':500000},{'account_id':103,'amount':500000}]})
        before=finance_state(self.store,self.user,1)['summary']['reinvestment_available']
        self.cmd('reinvestment_use',{'account_id':101,'amount':80000,'date':today(),'concept':'Surtido'})
        self.assertEqual(finance_state(self.store,self.user,1)['summary']['reinvestment_available'],before-8000000)

    def test_transfer_and_business_separation(self):
        before=finance_state(self.store,self.user,1)['summary']['total']
        self.cmd('transfer',{'from_account_id':102,'to_account_id':103,'amount':100000,'date':today()})
        after=finance_state(self.store,self.user,1)
        self.assertEqual(after['summary']['total'],before)
        self.assertEqual(len(finance_state(self.store,self.user,2)['movements']),3)
        self.cmd('settings',{'distribution_pct':40,'reinvestment_pct':10},1)
        self.assertEqual(finance_state(self.store,self.user,1)['settings']['distribution_pct'],4000)
        self.assertEqual(finance_state(self.store,self.user,2)['settings']['distribution_pct'],3000)

    def test_user_without_permission_cannot_read_other_business(self):
        with self.store.connect() as db:
            user_id=db.execute("INSERT INTO users(username,name,password,role,businesses) VALUES('limited','Limitado','x','cashier','[1,2]')").lastrowid
            db.execute('INSERT INTO finance_permissions(user_id,business_id,can_view) VALUES(?,?,1)',(user_id,1))
        limited={'id':user_id,'role':'cashier'}
        self.assertTrue(finance_state(self.store,limited,1)['accounts'])
        with self.assertRaises(ValueError): finance_state(self.store,limited,2)
        with self.assertRaises(ValueError): finance_command(self.store,limited,1,'invoice_create',{})

    def test_pending_records_do_not_reduce_real_balance(self):
        before=finance_state(self.store,self.user,1)['summary']['total']
        self.cmd('invoice_create',{'invoice_date':today(),'description':'Factura pendiente','total':80000,'payments':[]})
        employee=self.cmd('employee_create',{'name':'Pendiente','document':'99','salary':100000,'started':today()})['id']
        self.cmd('payroll_create',{'employee_id':employee,'period':'2026-08','base_salary':100000})
        self.assertEqual(finance_state(self.store,self.user,1)['summary']['total'],before)

    def test_existing_profit_can_be_assigned_without_recreating_it(self):
        with self.store.connect() as db:
            profit=db.execute("INSERT INTO finance_profits(business_id,period,profit,distribution_pct,reinvestment_pct,distribution_fund,reinvestment,available_distribution,remaining_profit,created_by,created_at) VALUES(1,'2025-12',100000000,3000,1700,30000000,5100000,24900000,70000000,?,?)",(self.user['id'],today())).lastrowid
        before=finance_state(self.store,self.user,1)['summary']['total']
        self.cmd('profit_fund',{'profit_id':profit,'date':today(),'allocations':[{'account_id':101,'amount':200000},{'account_id':102,'amount':300000},{'account_id':103,'amount':500000}]})
        state=finance_state(self.store,self.user,1)
        self.assertEqual(state['summary']['total']-before,100000000)
        self.assertEqual(next(x for x in state['profits'] if x['id']==profit)['funded'],100000000)

if __name__=='__main__': unittest.main()
