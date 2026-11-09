import json, re, secrets
from datetime import datetime, date

def clean(value, limit=500): return str(value or '').strip()[:limit]
def cents(value):
    try: result=round(float(value or 0)*100)
    except: raise ValueError('Valor monetario inválido')
    if result<0 or result>10**13: raise ValueError('Valor monetario inválido')
    return result
def valid_date(value, optional=False):
    if optional and not value: return None
    try: return date.fromisoformat(str(value)).isoformat()
    except: raise ValueError('Fecha inválida')
def now(): return datetime.now().astimezone().isoformat(timespec='seconds')
def rows(db,sql,args=()): return [dict(x) for x in db.execute(sql,args).fetchall()]
def one(db,sql,args=()):
    item=db.execute(sql,args).fetchone(); return dict(item) if item else None

CAP={'view':'can_view','create':'can_create','write':'can_create','edit':'can_edit','authorize':'can_authorize','configure':'can_configure','void':'can_void','report':'can_export','export':'can_export'}
def permission(db,user,business,cap='view'):
    item=one(db,f'SELECT {CAP[cap]} allowed FROM finance_permissions WHERE user_id=? AND business_id=?',(user['id'],business))
    if not item or not item['allowed']: raise ValueError('No tiene permiso para esta operación contable')

def balance(db,business,account):
    item=one(db,"SELECT a.*,a.opening_balance+COALESCE((SELECT SUM(direction*amount) FROM finance_movements WHERE account_id=a.id AND status='confirmed'),0) balance FROM finance_accounts a WHERE id=? AND business_id=? AND active=1",(account,business))
    if not item: raise ValueError('Cuenta financiera no encontrada')
    return item
def movement(db,user,business,account,amount,direction,kind,concept,effective,source_type=None,source_id=None,request_id=None):
    current=balance(db,business,int(account)); new=current['balance']+direction*amount
    if amount<=0: raise ValueError('El valor del movimiento debe ser mayor que cero')
    rid=clean(request_id) or secrets.token_urlsafe(18)
    cursor=db.execute('INSERT INTO finance_movements(business_id,account_id,created,effective_date,kind,concept,source_type,source_id,direction,amount,balance_after,user_id,request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',(business,int(account),now(),valid_date(effective),kind,clean(concept),source_type,source_id,direction,amount,new,user['id'],rid))
    return cursor.lastrowid

BANK_METHODS=(('Efectivo','efectivo'),('Nequi','nequi'),('Bancolombia','bancolombia'))
def sync_bank_closures(db,business):
    """Postea una sola vez las ventas netas de cada caja cerrada al banco contable."""
    pending=rows(db,"""SELECT c.id cash_id,c.closed closed_at,COALESCE(c.closed_by,c.user_id) posted_by,
        COALESCE(SUM(CASE WHEN p.method='Efectivo' AND p.sale_id IS NOT NULL AND p.kind!='Abono' THEN p.amount ELSE 0 END),0) efectivo,
        COALESCE(SUM(CASE WHEN p.method='Nequi' AND p.sale_id IS NOT NULL AND p.kind!='Abono' THEN p.amount ELSE 0 END),0) nequi,
        COALESCE(SUM(CASE WHEN p.method='Bancolombia' AND p.sale_id IS NOT NULL AND p.kind!='Abono' THEN p.amount ELSE 0 END),0) bancolombia
        FROM cash_sessions c LEFT JOIN payments p ON p.cash_id=c.id
        WHERE c.business_id=? AND c.closed IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM finance_bank_closures x WHERE x.business_id=c.business_id AND x.cash_id=c.id)
        GROUP BY c.id,c.closed,c.closed_by,c.user_id ORDER BY c.id""",(business,))
    if not pending: return
    accounts={item['name']:item for item in rows(db,'SELECT * FROM finance_accounts WHERE business_id=? AND active=1',(business,))}
    for close in pending:
        total=sum(close[column] for _,column in BANK_METHODS)
        db.execute('INSERT INTO finance_bank_closures(business_id,cash_id,closed_at,efectivo,nequi,bancolombia,total,posted_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)',(business,close['cash_id'],close['closed_at'],close['efectivo'],close['nequi'],close['bancolombia'],total,close['posted_by'],now()))
        effective=str(close['closed_at'])[:10]
        for method,column in BANK_METHODS:
            signed=int(close[column] or 0)
            if not signed or method not in accounts: continue
            direction=1 if signed>0 else -1; value=abs(signed); account=accounts[method]
            movement(db,{'id':close['posted_by']},business,account['id'],value,direction,'Ventas de caja cerrada',f'{method} · cierre de caja #{close["cash_id"]}',effective,'cash_close',close['cash_id'],f'bank-close:{close["cash_id"]}:{account["id"]}')

def finance_state(store,user,business,start='2000-01-01',end='2999-12-31'):
    with store.connect() as db:
        permission(db,user,business)
        sync_bank_closures(db,business)
        accounts=rows(db,"SELECT a.*,a.opening_balance+COALESCE((SELECT SUM(direction*amount) FROM finance_movements WHERE account_id=a.id AND status='confirmed'),0) balance FROM finance_accounts a WHERE business_id=? AND active=1 ORDER BY id",(business,))
        invoices=rows(db,"SELECT i.*,COALESCE((SELECT SUM(amount) FROM finance_invoice_payments WHERE invoice_id=i.id AND status='confirmed'),0) paid FROM finance_invoices i WHERE business_id=? ORDER BY invoice_date DESC,id DESC",(business,))
        invoice_payments=rows(db,"SELECT p.invoice_id,p.account_id,p.amount,p.paid_at,a.name account FROM finance_invoice_payments p JOIN finance_accounts a ON a.id=p.account_id WHERE p.business_id=? AND p.status='confirmed' ORDER BY p.id",(business,))
        for invoice in invoices: invoice['payments']=[item for item in invoice_payments if item['invoice_id']==invoice['id']]
        employees=rows(db,'SELECT * FROM finance_employees WHERE business_id=? ORDER BY active DESC,name',(business,))
        payrolls=rows(db,"SELECT p.*,e.name employee,COALESCE((SELECT SUM(amount) FROM finance_payroll_payments WHERE payroll_id=p.id AND status='confirmed'),0) paid FROM finance_payrolls p JOIN finance_employees e ON e.id=p.employee_id WHERE p.business_id=? ORDER BY p.period DESC,p.id DESC",(business,))
        profits=rows(db,"SELECT p.*,COALESCE((SELECT SUM(amount) FROM finance_profit_payouts WHERE profit_id=p.id AND status='confirmed'),0) distributed,COALESCE((SELECT SUM(amount) FROM finance_profit_funding WHERE profit_id=p.id),0) funded FROM finance_profits p WHERE p.business_id=? ORDER BY period DESC",(business,))
        moves=rows(db,"""SELECT m.*,a.name account,u.name operator,
            a.opening_balance+SUM(m.direction*m.amount) OVER(PARTITION BY m.account_id ORDER BY m.effective_date,m.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) balance_after
            FROM finance_movements m JOIN finance_accounts a ON a.id=m.account_id JOIN users u ON u.id=m.user_id
            WHERE m.business_id=? AND m.status='confirmed' AND m.effective_date BETWEEN ? AND ? ORDER BY m.effective_date DESC,m.id DESC LIMIT 1000""",(business,valid_date(start),valid_date(end)))
        bank_closures=rows(db,'SELECT * FROM finance_bank_closures WHERE business_id=? ORDER BY closed_at DESC,id DESC LIMIT 200',(business,))
        bank_sales=one(db,'SELECT COALESCE(SUM(efectivo),0) efectivo,COALESCE(SUM(nequi),0) nequi,COALESCE(SUM(bancolombia),0) bancolombia FROM finance_bank_closures WHERE business_id=?',(business,))
        bank_spent={item['account']:item['amount'] for item in rows(db,"SELECT a.name account,COALESCE(SUM(p.amount),0) amount FROM finance_accounts a LEFT JOIN finance_invoice_payments p ON p.account_id=a.id AND p.business_id=? AND p.status='confirmed' WHERE a.business_id=? AND a.name IN ('Efectivo','Nequi','Bancolombia') GROUP BY a.id,a.name",(business,business))}
        bank={method:{'sales':bank_sales[column],'spent':bank_spent.get(method,0),'balance':bank_sales[column]-bank_spent.get(method,0)} for method,column in BANK_METHODS}
        bank['total']=sum(item['balance'] for item in bank.values())
        used=one(db,"SELECT COALESCE(SUM(amount),0) n FROM finance_reinvestment_uses WHERE business_id=? AND status='confirmed'",(business,))['n']; accrued=sum(x['reinvestment'] for x in profits)
        month=date.today().isoformat()[:7]; monthly=[x for x in moves if x['effective_date'].startswith(month)]
        return {'permission':one(db,'SELECT * FROM finance_permissions WHERE user_id=? AND business_id=?',(user['id'],business)),'settings':one(db,'SELECT * FROM finance_settings WHERE business_id=?',(business,)),'accounts':accounts,'invoices':invoices,'bank':bank,'bank_closures':bank_closures,'employees':employees,'payrolls':payrolls,'profits':profits,'beneficiaries':rows(db,'SELECT * FROM finance_beneficiaries WHERE business_id=? AND active=1 ORDER BY name',(business,)),'movements':moves,'reconciliations':rows(db,'SELECT r.*,a.name account FROM finance_reconciliations r JOIN finance_accounts a ON a.id=r.account_id WHERE r.business_id=? ORDER BY r.id DESC LIMIT 100',(business,)),'summary':{'total':sum(x['balance'] for x in accounts),'invoice_pending':sum(max(0,x['total']-x['paid']) for x in invoices),'payroll_pending':sum(max(0,x['net_total']-x['paid']) for x in payrolls),'reinvestment_accrued':accrued,'reinvestment_used':used,'reinvestment_available':accrued-used,'distribution_pending':sum(max(0,x['available_distribution']-x['distributed']) for x in profits),'income':sum(x['amount'] for x in monthly if x['direction']==1),'expense':sum(x['amount'] for x in monthly if x['direction']==-1)}}

def finance_command(store,user,business,action,data):
    required='configure' if action in ('settings','account_adjust','reconcile') else 'edit' if action=='invoice_edit' else 'authorize' if action in ('invoice_pay','payroll_pay','profit_payout','transfer','reinvestment_use') else 'create'
    with store.connect() as db:
        permission(db,user,business,required); result={'ok':True}; rid=clean(data.get('request_id')) or secrets.token_urlsafe(18)
        if action=='settings':
            distribution=round(float(data['distribution_pct'])*100); reinvestment=round(float(data['reinvestment_pct'])*100)
            if not 0<=distribution<=10000 or not 0<=reinvestment<=10000: raise ValueError('Porcentajes inválidos')
            db.execute('UPDATE finance_settings SET distribution_pct=?,reinvestment_pct=?,updated_by=?,updated_at=? WHERE business_id=?',(distribution,reinvestment,user['id'],now(),business))
        elif action=='account_adjust':
            observed=cents(data['amount']); current=balance(db,business,int(data['account_id'])); delta=observed-current['balance']
            if delta: movement(db,user,business,data['account_id'],abs(delta),1 if delta>0 else -1,'Ajuste autorizado',clean(data.get('note')) or 'Ajuste de saldo',data.get('date') or date.today().isoformat(),request_id=rid)
        elif action=='invoice_create':
            total=cents(data['total']); payments={}
            for p in data.get('payments',[]): payments[int(p['account_id'])]=payments.get(int(p['account_id']),0)+cents(p.get('amount'))
            paid=sum(payments.values())
            if not clean(data.get('description')) or total<=0 or paid>total: raise ValueError('Revise descripción, total y pagos')
            invoice=db.execute('INSERT INTO finance_invoices(business_id,number,invoice_date,description,total,tax,supplier,supplier_document,category,due_date,note,attachment,purchase_id,status,created_by,created_at,request_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(business,clean(data.get('number')) or 'INT-'+datetime.now().strftime('%Y%m%d%H%M%S'),valid_date(data['invoice_date']),clean(data['description']),total,cents(data.get('tax')),clean(data.get('supplier')),clean(data.get('supplier_document')),clean(data.get('category')),valid_date(data.get('due_date'),True),clean(data.get('note'),1000),clean(data.get('attachment')),data.get('purchase_id') or None,'paid' if paid==total else 'partial' if paid else 'pending',user['id'],now(),rid)).lastrowid
            for account,amount in payments.items():
                if not amount: continue
                mrid=f'{rid}:{account}'; mid=movement(db,user,business,account,amount,-1,'Pago de factura',data['description'],data['invoice_date'],'invoice',invoice,mrid)
                db.execute('INSERT INTO finance_invoice_payments(business_id,invoice_id,account_id,amount,paid_at,user_id,movement_id,request_id) VALUES(?,?,?,?,?,?,?,?)',(business,invoice,account,amount,valid_date(data['invoice_date']),user['id'],mid,mrid))
            result['id']=invoice
        elif action=='invoice_edit':
            invoice=one(db,'SELECT * FROM finance_invoices WHERE id=? AND business_id=?',(int(data.get('invoice_id') or 0),business)); total=cents(data['total']); payments={}
            if not invoice: raise ValueError('Factura no encontrada')
            for item in data.get('payments',[]):
                account=int(item['account_id']); payments[account]=payments.get(account,0)+cents(item.get('amount'))
            paid=sum(payments.values())
            if not clean(data.get('description')) or total<=0 or paid>total: raise ValueError('Revise descripción, total y pagos')
            old=rows(db,"SELECT * FROM finance_invoice_payments WHERE invoice_id=? AND status='confirmed'",(invoice['id'],))
            if old:
                ids=[item['movement_id'] for item in old]; db.execute(f"UPDATE finance_movements SET status='void' WHERE id IN ({','.join('?' for _ in ids)})",ids)
                db.execute("UPDATE finance_invoice_payments SET status='void' WHERE invoice_id=? AND status='confirmed'",(invoice['id'],))
            status='paid' if paid==total else 'partial' if paid else 'pending'
            attachment=invoice['attachment'] if 'attachment' not in data else clean(data.get('attachment'),500)
            db.execute('UPDATE finance_invoices SET number=?,invoice_date=?,description=?,total=?,tax=?,supplier=?,supplier_document=?,category=?,due_date=?,note=?,attachment=?,status=? WHERE id=? AND business_id=?',(clean(data.get('number')) or invoice['number'],valid_date(data['invoice_date']),clean(data['description']),total,cents(data.get('tax',invoice['tax']/100)),clean(data.get('supplier')),clean(data.get('supplier_document')),clean(data.get('category')),valid_date(data.get('due_date'),True),clean(data.get('note'),1000),attachment,status,invoice['id'],business))
            for account,amount in payments.items():
                if not amount: continue
                mrid=f'{rid}:{account}'; mid=movement(db,user,business,account,amount,-1,'Pago de factura editada',data['description'],data['invoice_date'],'invoice',invoice['id'],mrid)
                db.execute('INSERT INTO finance_invoice_payments(business_id,invoice_id,account_id,amount,paid_at,user_id,movement_id,request_id) VALUES(?,?,?,?,?,?,?,?)',(business,invoice['id'],account,amount,valid_date(data['invoice_date']),user['id'],mid,mrid))
            result['id']=invoice['id']
        elif action=='invoice_pay':
            inv=one(db,"SELECT i.*,COALESCE((SELECT SUM(amount) FROM finance_invoice_payments WHERE invoice_id=i.id AND status='confirmed'),0) paid FROM finance_invoices i WHERE id=? AND business_id=?",(int(data['invoice_id']),business)); payments={}
            for item in data.get('payments',[]):
                account=int(item['account_id']); payments[account]=payments.get(account,0)+cents(item.get('amount'))
            if not payments and data.get('account_id'): payments[int(data['account_id'])]=cents(data.get('amount'))
            amount=sum(payments.values())
            if not inv or amount<=0 or amount>inv['total']-inv['paid']: raise ValueError('El abono supera el saldo')
            for account,value in payments.items():
                if not value: continue
                mrid=f'{rid}:{account}'; mid=movement(db,user,business,account,value,-1,'Abono a factura',inv['description'],data['date'],'invoice',inv['id'],mrid)
                db.execute('INSERT INTO finance_invoice_payments(business_id,invoice_id,account_id,amount,paid_at,user_id,movement_id,request_id) VALUES(?,?,?,?,?,?,?,?)',(business,inv['id'],account,value,valid_date(data['date']),user['id'],mid,mrid))
            db.execute('UPDATE finance_invoices SET status=? WHERE id=?',('paid' if amount==inv['total']-inv['paid'] else 'partial',inv['id']))
        elif action=='employee_create':
            result['id']=db.execute('INSERT INTO finance_employees(business_id,name,document,position,salary,started,usual_account_id,note) VALUES(?,?,?,?,?,?,?,?)',(business,clean(data['name']),clean(data.get('document')),clean(data.get('position')),cents(data['salary']),valid_date(data['started']),data.get('usual_account_id') or None,clean(data.get('note'),1000))).lastrowid
        elif action=='payroll_create':
            emp=one(db,'SELECT * FROM finance_employees WHERE id=? AND business_id=?',(int(data['employee_id']),business)); base=cents(data.get('base_salary',emp['salary']/100 if emp else 0)); bonuses=cents(data.get('bonuses')); advances=cents(data.get('advances')); deductions=cents(data.get('deductions')); net=base+bonuses-advances-deductions
            if not emp or not re.fullmatch(r'\d{4}-\d{2}',str(data['period'])) or net<0: raise ValueError('Revise empleado, período y valores')
            result['id']=db.execute('INSERT INTO finance_payrolls(business_id,employee_id,period,days_worked,base_salary,bonuses,advances,deductions,net_total,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',(business,emp['id'],data['period'],int(data.get('days_worked',30)),base,bonuses,advances,deductions,net,user['id'],now())).lastrowid
        elif action=='payroll_pay':
            payroll=one(db,"SELECT p.*,e.name employee,COALESCE((SELECT SUM(amount) FROM finance_payroll_payments WHERE payroll_id=p.id AND status='confirmed'),0) paid FROM finance_payrolls p JOIN finance_employees e ON e.id=p.employee_id WHERE p.id=? AND p.business_id=?",(int(data['payroll_id']),business)); amount=cents(data['amount'])
            if not payroll or amount<=0 or amount>payroll['net_total']-payroll['paid']: raise ValueError('El pago supera el saldo de nómina')
            mid=movement(db,user,business,data['account_id'],amount,-1,'Pago de nómina',payroll['employee']+' '+payroll['period'],data['date'],'payroll',payroll['id'],rid)
            db.execute('INSERT INTO finance_payroll_payments(business_id,payroll_id,account_id,amount,paid_at,user_id,movement_id,request_id) VALUES(?,?,?,?,?,?,?,?)',(business,payroll['id'],int(data['account_id']),amount,valid_date(data['date']),user['id'],mid,rid)); db.execute('UPDATE finance_payrolls SET status=? WHERE id=?',('paid' if amount==payroll['net_total']-payroll['paid'] else 'partial',payroll['id']))
        elif action=='profit_create':
            settings=one(db,'SELECT * FROM finance_settings WHERE business_id=?',(business,)); profit=cents(data['profit']); fund=round(profit*settings['distribution_pct']/10000); reinvestment=round(fund*settings['reinvestment_pct']/10000)
            if not re.fullmatch(r'\d{4}-\d{2}',str(data.get('period',''))) or profit<=0: raise ValueError('Revise el período y la utilidad')
            allocations={}
            for item in data.get('allocations',[]):
                account=int(item['account_id']); allocations[account]=allocations.get(account,0)+cents(item.get('amount'))
            result['id']=db.execute('INSERT INTO finance_profits(business_id,period,profit,distribution_pct,reinvestment_pct,distribution_fund,reinvestment,available_distribution,remaining_profit,note,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',(business,data['period'],profit,settings['distribution_pct'],settings['reinvestment_pct'],fund,reinvestment,fund-reinvestment,profit-fund,clean(data.get('note'),1000),user['id'],now())).lastrowid
            for account,value in allocations.items():
                if not value: continue
                mrid=f'{rid}:{account}'; mid=movement(db,user,business,account,value,1,'Utilidad registrada',f'Utilidad de {data["period"]}',data.get('date') or date.today().isoformat(),'profit',result['id'],mrid)
                db.execute('INSERT INTO finance_profit_funding(business_id,profit_id,account_id,amount,movement_id) VALUES(?,?,?,?,?)',(business,result['id'],account,value,mid))
        elif action=='profit_fund':
            profit=one(db,"SELECT p.*,COALESCE((SELECT SUM(amount) FROM finance_profit_funding WHERE profit_id=p.id),0) funded FROM finance_profits p WHERE p.id=? AND p.business_id=?",(int(data['profit_id']),business))
            if not profit: raise ValueError('Utilidad no encontrada')
            allocations={}
            for item in data.get('allocations',[]):
                account=int(item['account_id']); allocations[account]=allocations.get(account,0)+cents(item.get('amount'))
            for account,value in allocations.items():
                if not value: continue
                mrid=f'{rid}:{account}'; mid=movement(db,user,business,account,value,1,'Utilidad registrada',f'Utilidad de {profit["period"]}',data.get('date') or date.today().isoformat(),'profit',profit['id'],mrid)
                db.execute('INSERT INTO finance_profit_funding(business_id,profit_id,account_id,amount,movement_id) VALUES(?,?,?,?,?) ON CONFLICT(profit_id,account_id) DO UPDATE SET amount=amount+excluded.amount,movement_id=excluded.movement_id',(business,profit['id'],account,value,mid))
        elif action=='beneficiary_create':
            if not clean(data.get('name')): raise ValueError('Escriba el beneficiario')
            result['id']=db.execute('INSERT INTO finance_beneficiaries(business_id,name,document) VALUES(?,?,?)',(business,clean(data['name']),clean(data.get('document')))).lastrowid
        elif action=='profit_payout':
            profit=one(db,"SELECT p.*,COALESCE((SELECT SUM(amount) FROM finance_profit_payouts WHERE profit_id=p.id AND status='confirmed'),0) paid FROM finance_profits p WHERE p.id=? AND p.business_id=?",(int(data['profit_id']),business)); beneficiary=one(db,'SELECT * FROM finance_beneficiaries WHERE id=? AND business_id=?',(int(data['beneficiary_id']),business)); amount=cents(data['amount'])
            if not profit or not beneficiary or amount<=0 or amount>profit['available_distribution']-profit['paid']: raise ValueError('El reparto supera el fondo disponible')
            mid=movement(db,user,business,data['account_id'],amount,-1,'Reparto de utilidad',beneficiary['name']+' '+profit['period'],data['date'],'profit',profit['id'],rid)
            result['id']=db.execute('INSERT INTO finance_profit_payouts(business_id,profit_id,beneficiary_id,account_id,amount,paid_at,user_id,movement_id,request_id) VALUES(?,?,?,?,?,?,?,?,?)',(business,profit['id'],beneficiary['id'],int(data['account_id']),amount,valid_date(data['date']),user['id'],mid,rid)).lastrowid
        elif action=='reinvestment_use':
            accrued=one(db,'SELECT COALESCE(SUM(reinvestment),0) n FROM finance_profits WHERE business_id=?',(business,))['n']; used=one(db,"SELECT COALESCE(SUM(amount),0) n FROM finance_reinvestment_uses WHERE business_id=? AND status='confirmed'",(business,))['n']; amount=cents(data['amount'])
            if amount<=0 or amount>accrued-used: raise ValueError('El retiro supera el fondo de reinversión')
            if data.get('invoice_id') and one(db,"SELECT id FROM finance_reinvestment_uses WHERE invoice_id=? AND business_id=? AND status='confirmed'",(int(data['invoice_id']),business)): raise ValueError('Esta factura ya está vinculada a un retiro')
            mid=movement(db,user,business,data['account_id'],amount,-1,'Uso de reinversión',clean(data.get('concept')),data['date'],'reinvestment',None,rid)
            result['id']=db.execute('INSERT INTO finance_reinvestment_uses(business_id,account_id,amount,used_at,concept,invoice_id,note,user_id,movement_id,request_id) VALUES(?,?,?,?,?,?,?,?,?,?)',(business,int(data['account_id']),amount,valid_date(data['date']),clean(data.get('concept')),data.get('invoice_id') or None,clean(data.get('note'),1000),user['id'],mid,rid)).lastrowid
        elif action=='transfer':
            amount=cents(data['amount']); source=int(data['from_account_id']); target=int(data['to_account_id'])
            if source==target: raise ValueError('Seleccione cuentas diferentes')
            movement(db,user,business,source,amount,-1,'Transferencia enviada',clean(data.get('concept')) or 'Transferencia interna',data['date'],request_id=rid+':out'); movement(db,user,business,target,amount,1,'Transferencia recibida',clean(data.get('concept')) or 'Transferencia interna',data['date'],request_id=rid+':in')
        elif action=='reconcile':
            current=balance(db,business,int(data['account_id'])); observed=cents(data['observed']); result['id']=db.execute('INSERT INTO finance_reconciliations(business_id,account_id,observed,book_balance,difference,reconciled_at,note,user_id) VALUES(?,?,?,?,?,?,?,?)',(business,int(data['account_id']),observed,current['balance'],observed-current['balance'],now(),clean(data.get('note'),1000),user['id'])).lastrowid
        else: raise ValueError('Operación contable todavía no disponible')
        db.execute('INSERT INTO audit(business_id,user_id,created,action,detail) VALUES(?,?,?,?,?)',(business,user['id'],now(),'finance:'+action,json.dumps({k:v for k,v in data.items() if k!='attachment'},ensure_ascii=False)))
        return result
