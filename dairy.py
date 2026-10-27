import secrets
from datetime import date, datetime

def now(): return datetime.now().astimezone().isoformat(timespec='seconds')
def clean(v,n=500): return str(v or '').strip()[:n]
def iso(v):
    try: return date.fromisoformat(str(v)).isoformat()
    except: raise ValueError('Fecha inválida')
def cents(v):
    try: value=round(float(v or 0)*100)
    except: raise ValueError('Valor inválido')
    if value<0 or value>10**13: raise ValueError('Valor inválido')
    return value
def one(db,sql,args=()):
    row=db.execute(sql,args).fetchone(); return dict(row) if row else None
def rows(db,sql,args=()): return [dict(x) for x in db.execute(sql,args)]
CAP={'view':'can_view','price':'can_price','void':'can_void','close':'can_close','reopen':'can_reopen'}
def permission(db,user,cap):
    p=one(db,f'SELECT {CAP[cap]} allowed FROM dairy_permissions WHERE user_id=?',(user['id'],))
    if not p or not p['allowed']: raise ValueError('No tiene permiso para esta operación de lácteos')

def dairy_state(store,user,start=None,end=None):
    start=iso(start or date.today()); end=iso(end or start)
    if start>end: raise ValueError('Rango de fechas inválido')
    with store.connect() as db:
        permission(db,user,'view')
        products=rows(db,'SELECT * FROM dairy_products WHERE active=1 ORDER BY id')
        lines=rows(db,"""SELECT l.*,p.name,p.unit,s.number sale_number,u.name operator,
          COALESCE((SELECT SUM(r.qty) FROM dairy_returns r WHERE r.line_id=l.id),0) returned_qty,
          COALESCE((SELECT SUM(r.amount) FROM dairy_returns r WHERE r.line_id=l.id),0) returned_amount,
          COALESCE((SELECT GROUP_CONCAT(method||': '||printf('%.2f',amount/100.0),' · ') FROM (SELECT method,SUM(amount) amount FROM (SELECT method,amount FROM payments WHERE sale_id=l.sale_id AND amount>0 UNION ALL SELECT method,amount FROM dairy_payments WHERE sale_id=l.sale_id AND amount>0) GROUP BY method)),'Sin pago registrado') payment_methods
          FROM dairy_sale_lines l JOIN dairy_products p ON p.id=l.product_id JOIN sales s ON s.id=l.sale_id JOIN users u ON u.id=l.user_id
          WHERE substr(l.created,1,10) BETWEEN ? AND ? ORDER BY l.created DESC,l.id DESC""",(start,end))
        closures=rows(db,'SELECT c.*,u.name operator FROM dairy_closures c JOIN users u ON u.id=c.closed_by WHERE c.day BETWEEN ? AND ? ORDER BY c.day DESC',(start,end))
        milk=[x for x in lines if x['product_id']==1 and x['status']=='active']; cheese=[x for x in lines if x['product_id']==2 and x['status']=='active']
        net=lambda xs,key:sum(max(0,x[key]-x['returned_amount' if key=='total' else 'returned_qty']) for x in xs)
        return {'permission':one(db,'SELECT * FROM dairy_permissions WHERE user_id=?',(user['id'],)),'products':products,'lines':lines,'closures':closures,'start':start,'end':end,'summary':{'milk_qty':net(milk,'qty'),'milk_total':net(milk,'total'),'cheese_qty':net(cheese,'qty'),'cheese_total':net(cheese,'total'),'total':net(milk,'total')+net(cheese,'total')}}

def dairy_command(store,user,action,data):
    required={'price':'price','return':'void','close':'close','reopen':'reopen'}.get(action,'view')
    with store.connect() as db:
        permission(db,user,required); result={'ok':True}
        if action=='price':
            product=one(db,'SELECT * FROM dairy_products WHERE id=?',(int(data['product_id']),)); value=cents(data['price'])
            if not product or value<=0: raise ValueError('Producto o precio inválido')
            db.execute('UPDATE dairy_products SET price=? WHERE id=?',(value,product['id']))
        elif action=='return':
            line=one(db,"SELECT l.*,COALESCE((SELECT SUM(qty) FROM dairy_returns WHERE line_id=l.id),0) returned FROM dairy_sale_lines l WHERE l.id=? AND l.status='active'",(int(data['line_id']),))
            qty=round(float(data['qty'])*1000); reason=clean(data.get('reason')); rid=clean(data.get('request_id')) or secrets.token_urlsafe(18)
            if not line or qty<=0 or qty>line['qty']-line['returned'] or not reason: raise ValueError('Revise cantidad y motivo de devolución')
            if one(db,"SELECT 1 FROM dairy_closures WHERE day=substr(?,1,10) AND status='closed'",(line['created'],)): raise ValueError('Reabra el día antes de registrar una devolución')
            amount=round(qty*line['price']/1000)
            result['id']=db.execute('INSERT INTO dairy_returns(line_id,qty,amount,created,user_id,reason,request_id) VALUES(?,?,?,?,?,?,?)',(line['id'],qty,amount,now(),user['id'],reason,rid)).lastrowid
        elif action=='close':
            day=iso(data.get('day') or date.today()); existing=one(db,'SELECT * FROM dairy_closures WHERE day=?',(day,))
            if existing and existing['status']=='closed': raise ValueError('Este día ya está cerrado')
            expected=one(db,"""SELECT COALESCE(SUM(CASE WHEN l.status='active' THEN l.total ELSE 0 END),0)-COALESCE((SELECT SUM(r.amount) FROM dairy_returns r JOIN dairy_sale_lines x ON x.id=r.line_id WHERE substr(x.created,1,10)=?),0) n FROM dairy_sale_lines l WHERE substr(l.created,1,10)=?""",(day,day))['n']; counted=cents(data['counted'])
            if existing: db.execute("UPDATE dairy_closures SET expected=?,counted=?,difference=?,closed_at=?,closed_by=?,status='closed' WHERE id=?",(expected,counted,counted-expected,now(),user['id'],existing['id'])); result['id']=existing['id']
            else: result['id']=db.execute('INSERT INTO dairy_closures(day,expected,counted,difference,closed_at,closed_by) VALUES(?,?,?,?,?,?)',(day,expected,counted,counted-expected,now(),user['id'])).lastrowid
            result.update(expected=expected,difference=counted-expected)
        elif action=='reopen':
            day=iso(data['day']); reason=clean(data.get('reason')); closure=one(db,"SELECT * FROM dairy_closures WHERE day=? AND status='closed'",(day,))
            if not closure or not reason: raise ValueError('Seleccione un cierre y escriba el motivo')
            db.execute("UPDATE dairy_closures SET status='reopened',reopened_at=?,reopened_by=?,reopen_reason=? WHERE id=?",(now(),user['id'],reason,closure['id']))
        else: raise ValueError('Operación de lácteos inválida')
        db.execute('INSERT INTO audit(business_id,user_id,created,action,detail) VALUES(1,?,?,?,?)',(user['id'],now(),'dairy:'+action,clean(data,1000)))
        return result
