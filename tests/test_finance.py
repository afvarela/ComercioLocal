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
