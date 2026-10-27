import {randomBytes,createHash} from 'node:crypto';
import {rows,one,check,clean,admin,passwordHash,passwordCheck,command,Transaction,today} from './store.mjs';
import {state,history,analytics,inventoryReport,reportRows,receipt,receiptText} from './read.mjs';
import {inventoryXlsx,reportXlsx} from './xlsx.mjs';
import {financeState,financeCommand,financePermission} from './finance.mjs';
import {dairyState,dairyCommand,dairyPermission} from './dairy.mjs';
import {logisticsState,saleOptions,logisticsCommand,dispatchText,dispatchHtml,labelsHtml} from './logistics.mjs';
import {invoiceHtml,invoicePdf} from './invoice.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'SAMEORIGIN','Referrer-Policy':'same-origin','Strict-Transport-Security':'max-age=31536000'};
function json(data,status=200,extra={}){return new Response(JSON.stringify(data),{status,headers:{...headers,'Content-Type':'application/json; charset=utf-8',...extra}});}
const hash=v=>createHash('sha256').update(v).digest('hex');
const epoch=()=>Math.floor(Date.now()/1000);
export default {async fetch(request,env){
 try{
 const url=new URL(request.url),path=url.pathname,q=url.searchParams,post=request.method==='POST';
 if(!['GET','POST','HEAD'].includes(request.method))return json({error:'Método no permitido'},405);
 if(path==='/api/status')return json({setup:!(await one(env.DB,'SELECT 1 present FROM users WHERE active=1 LIMIT 1')),cloud:true,version:'3.3.2'});
 if(path.startsWith('/images/')){check(/^\/images\/[a-z0-9-]+\.(jpg|jpeg|png|webp|svg)$/.test(path),'Imagen invalida');const name=path.slice('/images/'.length),object=await env.IMAGES.get('products/'+name);if(!object)return env.ASSETS.fetch(request);const h=new Headers(headers);object.writeHttpMetadata(h);const extension=name.split('.').pop(),types={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',svg:'image/svg+xml; charset=utf-8'};h.set('Content-Type',types[extension]);h.set('ETag',object.httpEtag);h.set('Cache-Control','public,max-age=86400');return new Response(object.body,{headers:h});}
 if(!post&&!path.startsWith('/api/')&&!['/receipt','/receipt.txt','/invoice','/invoice.pdf','/dispatch','/dispatch.txt'].includes(path))return env.ASSETS.fetch(request);
 let d={};if(post){check(request.headers.get('X-POS-Request')==='1','Solicitud no autorizada');check(request.headers.get('Origin')===url.origin,'Origen no permitido');const text=await request.text();check(text.length<=1048576,'Solicitud demasiado grande');d=JSON.parse(text);}
 if(path==='/api/setup'&&post){
  const username=clean(d.username).toLowerCase(),name=clean(d.name);
  check(/^[a-z0-9._-]{3,50}$/.test(username),'El usuario debe tener entre 3 y 50 caracteres y usar letras, números, punto, guion o guion bajo');
  check(name.length>=2,'Escriba el nombre del administrador');
  const result=await env.DB.prepare("INSERT INTO users(username,name,password,role,businesses,active) SELECT ?,?,?,'admin','[1,2]',1 WHERE NOT EXISTS(SELECT 1 FROM users WHERE active=1)").bind(username,name,await passwordHash(String(d.password||''))).run();
  check(Number(result.meta?.changes||0)===1,'La cuenta administradora ya fue creada. Inicie sesión');
  const created=await one(env.DB,'SELECT id FROM users WHERE username=?',[username]);
  await env.DB.batch([1,2].map(b=>env.DB.prepare('INSERT OR REPLACE INTO finance_permissions(user_id,business_id,can_view,can_write,can_create,can_edit,can_authorize,can_report,can_export,can_configure,can_void) VALUES(?,?,1,1,1,1,1,1,1,1,1)').bind(created.id,b)));
  await env.DB.prepare('INSERT OR REPLACE INTO dairy_permissions(user_id,can_view,can_price,can_void,can_close,can_reopen) VALUES(?,1,1,1,1,1)').bind(created.id).run();
  return json({ok:true});
 }
 if(path==='/api/login'&&post){
  const key=hash(request.headers.get('CF-Connecting-IP')||'unknown'),time=epoch();
  const a=await env.DB.prepare('INSERT INTO cloud_attempts(key,count,expires) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<? THEN ? ELSE expires END RETURNING count').bind(key,time+300,time,time,time+300).first();
  if(a.count>10)return json({error:'Espere cinco minutos antes de intentar nuevamente'},429);
  const u=await one(env.DB,'SELECT * FROM users WHERE username=? AND active=1',[clean(d.username).toLowerCase()]);check(u&&await passwordCheck(d.password,u.password),'Usuario o contraseña incorrectos');const token=randomBytes(32).toString('hex');
  await env.DB.batch([env.DB.prepare('DELETE FROM cloud_sessions WHERE expires<?').bind(time),env.DB.prepare('INSERT INTO cloud_sessions(token,user_id,password_version,expires) VALUES(?,?,?,?)').bind(hash(token),u.id,hash(u.password),time+43200),env.DB.prepare('DELETE FROM cloud_attempts WHERE key=?').bind(key)]);
  return json({ok:true},200,{'Set-Cookie':`pos_cloud=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`});
 }
 const token=(request.headers.get('Cookie')||'').match(/(?:^|;\s*)pos_cloud=([a-f0-9]{64})(?:;|$)/)?.[1]||'';
 const user=token?await one(env.DB,'SELECT u.*,s.password_version FROM users u JOIN cloud_sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1',[hash(token),epoch()]):null;
 if(!user||hash(user.password)!==user.password_version)return json({error:'Inicie sesión para continuar'},401);
 const {password,password_version,...u}=user;
 if(path==='/api/logout'&&post){await env.DB.prepare('DELETE FROM cloud_sessions WHERE token=?').bind(hash(token)).run();return json({ok:true},200,{'Set-Cookie':'pos_cloud=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});}
 const allowed=JSON.parse(u.businesses),b=Number(q.get('business')||allowed[0]);check(allowed.includes(b),'No tiene acceso a este negocio');
 if(path==='/api/state'&&!post)return json(await state(env.DB,u,b));
 if(path==='/api/logistics'&&!post)return json(await logisticsState(env.DB,u,b,q.get('search')||''));
 if(path==='/api/dispatch-sale'&&!post)return json(await saleOptions(env.DB,u,b,Number(q.get('id'))));
 if(path==='/api/logistics-command'&&post)return json(await logisticsCommand(env.DB,u,b,d.action,d.data||{}));
 if(path==='/api/history'&&!post)return json(await history(env.DB,u,b,q.get('start')||today(),q.get('end')||today()));
 if(path==='/api/dairy'&&!post){check(b===1,'M?dulo disponible en mini market');return json(await dairyState(env.DB,u,q.get('start')||today(),q.get('end')||q.get('start')||today()));}
 if(path==='/api/dairy-command'&&post){check(b===1,'M?dulo disponible en mini market');return json(await dairyCommand(env.DB,u,d.action,d.data||{}));}
 if(path==='/api/finance'&&!post)return json(await financeState(env.DB,u,b,q.get('start')||'2000-01-01',q.get('end')||'2999-12-31'));
 if(path==='/api/finance-command'&&post)return json(await financeCommand(env.DB,u,b,d.action,d.data||{}));
 if(path==='/api/dairy-report.xlsx'&&!post){check(b===1,'Módulo disponible en mini market');await dairyPermission(env.DB,u,'view');const start=q.get('start')||today(),end=q.get('end')||start,dairy=await dairyState(env.DB,u,start,end),business=await one(env.DB,'SELECT * FROM businesses WHERE id=1'),columns=['Fecha','Venta','Producto','Cantidad','Unidad','Precio aplicado','Importe','Medio de pago','Usuario','Estado'],items=dairy.lines.map(x=>[x.created,x.sale_number,x.name,(x.qty-x.returned_qty)/1000,x.unit,x.price,x.total-x.returned_amount,x.payment_methods,x.operator,x.status]),file=reportXlsx(business,u,'Control de lácteos caseros',start,end,columns,items,[5,6]);return new Response(file,{headers:{...headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="Lacteos_${start}_${end}.xlsx"`}});}
 if(path==='/api/finance-report.xlsx'&&!post){await financePermission(env.DB,u,b,'report');const kind=q.get('kind')||'movements',start=q.get('start')||'2000-01-01',end=q.get('end')||'2999-12-31',f=await financeState(env.DB,u,b,start,end),business=await one(env.DB,'SELECT * FROM businesses WHERE id=?',[b]),specs={movements:['Movimientos financieros',['Fecha','Cuenta','Tipo','Concepto','Entrada','Salida','Saldo','Usuario'],f.movements.map(x=>[x.effective_date,x.account,x.kind,x.concept,x.direction>0?x.amount:0,x.direction<0?x.amount:0,x.balance_after,x.operator]),[4,5,6]],invoices:['Facturas de compra',['Fecha','Factura','Proveedor','Descripción','Total','Pagado','Saldo','Estado'],f.invoices.map(x=>[x.invoice_date,x.number,x.supplier,x.description,x.total,x.paid,x.total-x.paid,x.status]),[4,5,6]],payroll:['Nómina',['Período','Empleado','Neto','Pagado','Saldo','Estado'],f.payrolls.map(x=>[x.period,x.employee,x.net_total,x.paid,x.net_total-x.paid,x.status]),[2,3,4]],profits:['Utilidades',['Período','Utilidad','Fondo','Reinversión','Disponible','Restante'],f.profits.map(x=>[x.period,x.profit,x.distribution_fund,x.reinvestment,x.available_distribution,x.remaining_profit]),[1,2,3,4,5]]};check(specs[kind],'Reporte financiero inválido');const spec=specs[kind],file=reportXlsx(business,u,spec[0],start,end,spec[1],spec[2],spec[3]);return new Response(file,{headers:{...headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="Contabilidad_${kind}_${b}.xlsx"`}});}
 if(path==='/api/analytics'&&!post)return json(await analytics(env.DB,u,b,q.get('start')||today(),q.get('end')||today()));
 if(path==='/api/inventory.xlsx'&&!post){const category=q.get('category')||'',status=q.get('status')||'',search=q.get('search')||'',inStock=q.get('in_stock')==='1',r=await inventoryReport(env.DB,u,b,category,status,search,inStock),filters=[category&&`Categoría: ${category}`,status&&`Estado: ${status}`,search&&`Producto: ${search}`,inStock&&'Solo con existencia'].filter(Boolean).join('; '),data=inventoryXlsx(r.business,u,r.items,filters),name=r.business.name.replace(/[^A-Za-z0-9]+/g,'_');return new Response(data,{headers:{...headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="Inventario_Disponible_${name}_${today()}.xlsx"`}});}
 if(path==='/api/report.xlsx'&&!post){const start=q.get('start')||today(),end=q.get('end')||today(),kind=q.get('kind')||'ventas',r=await reportRows(env.DB,u,b,kind,start,end),data=reportXlsx(r.business,u,r.title,start,end,r.headers,r.data,r.money),name=r.business.name.replace(/[^A-Za-z0-9]+/g,'_');return new Response(data,{headers:{...headers,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="${kind}_${name}_${start}_${end}.xlsx"`}});}
 if(path==='/api/quote'&&!post){const r=await new Transaction(env.DB,0).scoped('quotes',Number(q.get('id')),b);r.lines=JSON.parse(r.lines);return json(r);}
 if(path==='/api/command'&&post)return json(await command(env.DB,u,b,d.action,d.data||{}));
 if(path==='/receipt'&&!post)return new Response(await receipt(env.DB,b,q.get('kind'),Number(q.get('id'))),{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
 if(path==='/receipt.txt'&&!post)return new Response(await receiptText(env.DB,b,q.get('kind'),Number(q.get('id'))),{headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}});
 if(path==='/invoice'&&!post)return new Response(await invoiceHtml(env.DB,b,Number(q.get('id'))),{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
 if(path==='/invoice.pdf'&&!post){const id=Number(q.get('id')),file=await invoicePdf(env.DB,b,id);return new Response(file,{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="factura-ferreteria-${String(id).padStart(6,'0')}.pdf"`}});}
 if(path==='/dispatch'&&!post)return new Response(await dispatchHtml(env.DB,b,Number(q.get('id'))),{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
 if(path==='/dispatch.txt'&&!post)return new Response(await dispatchText(env.DB,b,Number(q.get('id'))),{headers:{...headers,'Content-Type':'text/plain; charset=utf-8'}});
 if(path==='/labels-preview'&&post)return new Response(await labelsHtml(env.DB,b,d),{headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
 if(path==='/api/send-emails'&&post)return json({error:'El envío de correo en la nube requiere configurar un proveedor. Los mensajes permanecen en cola.'},400);
 if(path==='/api/export'&&!post){admin(u);const kind=q.get('kind');check(['sales','stock_moves','payments','top','debts','cash_moves','audit'].includes(kind),'Reporte inválido');const data=(await history(env.DB,u,b,q.get('start')||today(),q.get('end')||today()))[kind];const safe=v=>'"'+String(typeof v==='string'&&/^[=+\-@\t\r]/.test(v)?"'"+v:v??'').replaceAll('"','""')+'"';const csv=data.length?[Object.keys(data[0]),...data.map(Object.values)].map(r=>r.map(safe).join(';')).join('\r\n'):'';return new Response('\ufeff'+csv,{headers:{...headers,'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${kind}-${b}.csv"`}});}
 if(path==='/api/backup'&&!post){admin(u);const tables=['businesses','users','products','lots','customers','cash_sessions','quotes','sales','sale_lines','payments','cash_moves','stock_moves','audit','email_queue','finance_permissions','finance_settings','finance_accounts','finance_movements','finance_invoices','finance_invoice_payments','finance_employees','finance_payrolls','finance_payroll_payments','finance_profits','finance_beneficiaries','finance_profit_payouts','finance_reinvestment_uses','finance_reconciliations'];const result=await env.DB.batch(tables.map(t=>env.DB.prepare(`SELECT * FROM ${t}`)));return json({format:'comercio-d1-v2',created:new Date().toISOString(),tables:Object.fromEntries(tables.map((t,i)=>[t,result[i].results]))},200,{'Content-Disposition':'attachment; filename="comercio-d1-backup.json"'});}
 return json({error:'Ruta no encontrada'},404);
 }catch(e){const message=String(e.message||e);if(/D1_|SQLITE|constraint|database/i.test(message)){console.error(JSON.stringify({type:'database_error',message}));return json({error:/UNIQUE/.test(message)?'Referencia duplicada o transacción ya registrada':'No se pudo confirmar la operación. Reintente; las ventas conservan su identificador.'},409);}return json({error:message},400);}
}};
