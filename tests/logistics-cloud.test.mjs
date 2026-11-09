import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {logisticsCommand} from '../cloudflare/logistics.mjs';
import {command as storeCommand} from '../cloudflare/store.mjs';
import {stockHistory,customerStatement} from '../cloudflare/read.mjs';
import {dairyCommand,dairyState} from '../cloudflare/dairy.mjs';

class SQLiteD1 {
  constructor(){this.db=new DatabaseSync(':memory:')}
  prepare(sql){
    const database=this.db;let args=[];
    return {bind(...values){args=values;return this},async first(){return database.prepare(sql).get(...args)||null},async all(){return {results:database.prepare(sql).all(...args)}},async run(){return database.prepare(sql).run(...args)}};
  }
  async batch(statements){const results=[];for(const statement of statements)results.push(await statement.run());return results}
}

class LogisticsD1 {
  constructor(){
    this.version=0;
    this.dispatch={id:7,business_id:1,status:'Pendiente',delivered_at:null,received_by:'',delivery_note:'',confirmed_by:null};
    this.lines=[{id:11,dispatch_id:7,qty:3,delivered_qty:0},{id:12,dispatch_id:7,qty:5,delivered_qty:0}];
    this.history=[];
    this.audit=[];
  }
  prepare(sql){
    const db=this;let args=[];
    return {sql,bind(...values){args=values;this.args=args;return this;},async first(){
      if(sql==='SELECT version FROM cloud_revision WHERE id=1')return {version:db.version};
      if(sql.startsWith('SELECT * FROM dispatches WHERE id='))return Number(args[0])===db.dispatch.id&&Number(args[1])===db.dispatch.business_id?{...db.dispatch}:null;
      if(sql.includes('MAX(id)')&&sql.includes('dispatch_history'))return {n:db.history.length};
      if(sql.includes('MAX(id)')&&sql.includes('audit'))return {n:db.audit.length};
      throw Error('SQL first no simulado: '+sql);
    },async all(){
      if(sql.startsWith('SELECT * FROM dispatch_lines WHERE dispatch_id='))return {results:db.lines.filter(line=>line.dispatch_id===Number(args[0])).map(line=>({...line}))};
      throw Error('SQL all no simulado: '+sql);
    },async run(){return db.execute(sql,args);}};
  }
  async batch(statements){for(const statement of statements)await statement.run();return statements.map(()=>({success:true}));}
  execute(sql,args){
    if(sql.startsWith('UPDATE cloud_revision SET')){this.version+=1;return {meta:{changes:1}};}
    if(sql.startsWith('UPDATE dispatch_lines SET delivered_qty=qty')){this.lines.filter(line=>line.dispatch_id===Number(args[0])).forEach(line=>line.delivered_qty=line.qty);return {meta:{changes:2}};}
    if(sql.startsWith('UPDATE dispatch_lines SET delivered_qty=0')){this.lines.filter(line=>line.dispatch_id===Number(args[0])).forEach(line=>line.delivered_qty=0);return {meta:{changes:2}};}
    if(sql.startsWith('UPDATE dispatches SET status=')){const [status,delivered_at,received_by,delivery_note,confirmed_by,id,business]=args;if(id===this.dispatch.id&&business===this.dispatch.business_id)Object.assign(this.dispatch,{status,delivered_at,received_by,delivery_note,confirmed_by});return {meta:{changes:1}};}
    if(sql.startsWith('INSERT INTO dispatch_history')){const keys=sql.match(/\(([^)]+)\)/)[1].split(',');this.history.push(Object.fromEntries(keys.map((key,index)=>[key,args[index]])));return {meta:{changes:1}};}
    if(sql.startsWith('INSERT INTO audit')){const keys=sql.match(/\(([^)]+)\)/)[1].split(',');this.audit.push(Object.fromEntries(keys.map((key,index)=>[key,args[index]])));return {meta:{changes:1}};}
    throw Error('SQL run no simulado: '+sql);
  }
}

test('D1 conserva el estado activo al editar un producto y solo lo cambia de forma explicita',async()=>{
  const db=new SQLiteD1();
  db.db.exec(`
    CREATE TABLE cloud_revision(id INTEGER PRIMARY KEY,version INTEGER NOT NULL);
    INSERT INTO cloud_revision VALUES(1,0);
    CREATE TABLE products(id INTEGER PRIMARY KEY,business_id INTEGER,sku TEXT,barcode TEXT,name TEXT,description TEXT,category TEXT,unit TEXT,price INTEGER,min_stock INTEGER,max_stock INTEGER,reorder_point INTEGER,lead_time_days INTEGER,perishable INTEGER,active INTEGER,price_basis INTEGER,current_cost INTEGER);
    INSERT INTO products VALUES(1,1,'SKU-1',NULL,'Producto','', '', 'und',500000,0,0,0,3,0,1,1000,300000);
    CREATE TABLE lots(id INTEGER PRIMARY KEY,business_id INTEGER,product_id INTEGER,qty INTEGER,cost INTEGER,cost_basis INTEGER);
    INSERT INTO lots VALUES(1,1,1,10,300000,1000);
    CREATE TABLE stock_moves(id INTEGER PRIMARY KEY,business_id INTEGER,product_id INTEGER,lot_id INTEGER,user_id INTEGER,created TEXT,qty INTEGER,kind TEXT,reference TEXT,cost INTEGER,cost_basis INTEGER,balance_before INTEGER NOT NULL DEFAULT 0,balance_after INTEGER,note TEXT,request_id TEXT);
    CREATE TABLE audit(id INTEGER PRIMARY KEY,business_id INTEGER,user_id INTEGER,created TEXT,action TEXT,detail TEXT);
  `);
  const user={id:3,role:'admin'},base={id:1,name:'Producto editado',unit:'und',price:6000};
  await storeCommand(db,user,1,'product',base);
  assert.equal(db.db.prepare('SELECT active FROM products WHERE id=1').get().active,1);
  await storeCommand(db,user,1,'product',{...base,active:''});
  assert.equal(db.db.prepare('SELECT active FROM products WHERE id=1').get().active,0);
  await storeCommand(db,user,1,'product',{...base,active:'1'});
  assert.equal(db.db.prepare('SELECT active FROM products WHERE id=1').get().active,1);
  await storeCommand(db,user,1,'product',{...base,current_cost:4500});
  assert.equal(db.db.prepare('SELECT current_cost FROM products WHERE id=1').get().current_cost,450000);
  assert.equal(db.db.prepare('SELECT cost FROM lots WHERE id=1').get().cost,450000);
  assert.equal(db.db.prepare("SELECT COUNT(*) count FROM stock_moves WHERE kind='Ajuste de costo'").get().count,1);
  await storeCommand(db,user,1,'waste',{lot_id:1,qty:2,reason:'Avería'});
  assert.equal(db.db.prepare('SELECT qty FROM lots WHERE id=1').get().qty,8);
  const waste=db.db.prepare("SELECT * FROM stock_moves WHERE kind='Merma / ajuste'").get();
  assert.equal(waste.cost,450000);assert.equal(waste.balance_before,10);assert.equal(waste.balance_after,8);
});

test('D1 guarda el costo de recepción y actualiza el costo promedio del producto',async()=>{
  const db=new SQLiteD1();
  db.db.exec(`
    CREATE TABLE cloud_revision(id INTEGER PRIMARY KEY,version INTEGER NOT NULL);
    INSERT INTO cloud_revision VALUES(1,0);
    CREATE TABLE products(id INTEGER PRIMARY KEY,business_id INTEGER,sku TEXT,barcode TEXT,name TEXT,description TEXT,category TEXT,unit TEXT,price INTEGER,min_stock INTEGER,max_stock INTEGER,reorder_point INTEGER,lead_time_days INTEGER,perishable INTEGER,active INTEGER,price_basis INTEGER,current_cost INTEGER);
    INSERT INTO products VALUES(1,1,'ACEITE-1',NULL,'Aceite','', 'Mercado', 'und',500000,0,0,0,3,0,1,1,0);
    CREATE TABLE lots(id INTEGER PRIMARY KEY,business_id INTEGER,product_id INTEGER,code TEXT,expires TEXT,qty INTEGER,cost INTEGER,cost_basis INTEGER,supplier TEXT,reference TEXT,created TEXT,original_qty INTEGER,purchase_id INTEGER,status TEXT);
    CREATE TABLE purchases(id INTEGER PRIMARY KEY,business_id INTEGER,number INTEGER,supplier TEXT,reference TEXT,created TEXT,user_id INTEGER,total INTEGER,status TEXT,note TEXT,request_id TEXT);
    CREATE TABLE purchase_lines(id INTEGER PRIMARY KEY,purchase_id INTEGER,product_id INTEGER,lot_id INTEGER,qty INTEGER,returned_qty INTEGER DEFAULT 0,cost INTEGER,cost_basis INTEGER,total INTEGER);
    CREATE TABLE stock_moves(id INTEGER PRIMARY KEY,business_id INTEGER,product_id INTEGER,lot_id INTEGER,user_id INTEGER,created TEXT,qty INTEGER,kind TEXT,reference TEXT,cost INTEGER,cost_basis INTEGER,balance_before INTEGER NOT NULL DEFAULT 0,balance_after INTEGER,note TEXT,request_id TEXT);
    CREATE TABLE audit(id INTEGER PRIMARY KEY,business_id INTEGER,user_id INTEGER,created TEXT,action TEXT,detail TEXT);
  `);
  const user={id:3,role:'admin'};
  const receiveRequest='recepcion-cloud-000001';
  const first=await storeCommand(db,user,1,'receive',{product_id:1,qty:10,cost:2500,sale_price:5500,supplier:'Proveedor A',reference:'FAC-1',request_id:receiveRequest});
  const repeated=await storeCommand(db,user,1,'receive',{product_id:1,qty:10,cost:2500,sale_price:5500,supplier:'Proveedor A',reference:'FAC-1',request_id:receiveRequest});
  assert.equal(repeated.purchase_id,first.purchase_id);
  assert.equal(db.db.prepare('SELECT COUNT(*) count FROM purchases').get().count,1);
  assert.equal(db.db.prepare('SELECT COUNT(*) count FROM stock_moves').get().count,1);
  assert.equal(first.current_cost,250000);
  assert.equal(db.db.prepare('SELECT cost FROM lots WHERE id=?').get(first.id).cost,250000);
  assert.equal(db.db.prepare('SELECT current_cost FROM products WHERE id=1').get().current_cost,250000);
  assert.equal(db.db.prepare('SELECT total FROM purchases WHERE id=?').get(first.purchase_id).total,2500000);
  assert.deepEqual(
    {...db.db.prepare('SELECT cost,total FROM purchase_lines WHERE purchase_id=?').get(first.purchase_id)},
    {cost:250000,total:2500000},
  );
  const movement=db.db.prepare("SELECT cost,balance_before,balance_after FROM stock_moves WHERE kind='Compra'").get();
  assert.deepEqual({...movement},{cost:250000,balance_before:0,balance_after:10});

  const second=await storeCommand(db,user,1,'receive',{product_id:1,qty:10,cost:3500,sale_price:5500,supplier:'Proveedor B',reference:'FAC-2',request_id:'recepcion-cloud-000002'});
  assert.equal(second.current_cost,300000);
  assert.equal(db.db.prepare('SELECT current_cost FROM products WHERE id=1').get().current_cost,300000);
  assert.deepEqual(db.db.prepare('SELECT cost FROM lots ORDER BY id').all().map(row=>row.cost),[250000,350000]);
});

test('D1 crea clientes offline de forma idempotente',async()=>{
  const db=new SQLiteD1();
  db.db.exec(`
    CREATE TABLE cloud_revision(id INTEGER PRIMARY KEY,version INTEGER NOT NULL);
    INSERT INTO cloud_revision VALUES(1,0);
    CREATE TABLE customers(id INTEGER PRIMARY KEY,business_id INTEGER,name TEXT,document TEXT,phone TEXT,email TEXT,credit_limit INTEGER,request_id TEXT);
    CREATE UNIQUE INDEX idx_customers_offline_request ON customers(business_id,request_id) WHERE request_id IS NOT NULL;
    CREATE TABLE audit(id INTEGER PRIMARY KEY,business_id INTEGER,user_id INTEGER,created TEXT,action TEXT,detail TEXT);
  `);
  const payload={name:'Cliente offline',document:'123',credit_limit:0,request_id:'cliente-offline-123456'};
  const first=await storeCommand(db,{id:3,role:'admin'},1,'customer',payload);
  const second=await storeCommand(db,{id:3,role:'admin'},1,'customer',payload);
  assert.equal(first.id,second.id);
  assert.equal(db.db.prepare('SELECT COUNT(*) count FROM customers').get().count,1);
});

test('D1 descuenta una venta una sola vez y conserva antes y después',async()=>{
  const db=new SQLiteD1();
  db.db.exec(`
    CREATE TABLE cloud_revision(id INTEGER PRIMARY KEY,version INTEGER NOT NULL);
    INSERT INTO cloud_revision VALUES(1,0);
    CREATE TABLE cash_sessions(id INTEGER PRIMARY KEY,business_id INTEGER,user_id INTEGER,opened TEXT,closed TEXT,opening INTEGER);
    INSERT INTO cash_sessions VALUES(1,1,3,'2026-11-06T12:00:00.000Z',NULL,0);
    CREATE TABLE products(id INTEGER PRIMARY KEY,business_id INTEGER,sku TEXT,barcode TEXT,name TEXT,description TEXT,category TEXT,unit TEXT,price INTEGER,min_stock INTEGER,max_stock INTEGER,reorder_point INTEGER,lead_time_days INTEGER,perishable INTEGER,active INTEGER,price_basis INTEGER,current_cost INTEGER);
    INSERT INTO products VALUES(1,1,'SKU-1','7701','Producto venta','','Mercado','und',500000,0,0,0,3,0,1,1,300000);
    CREATE TABLE lots(id INTEGER PRIMARY KEY,business_id INTEGER,product_id INTEGER,code TEXT,expires TEXT,qty INTEGER,cost INTEGER,cost_basis INTEGER,supplier TEXT,reference TEXT,created TEXT,original_qty INTEGER,purchase_id INTEGER,status TEXT);
    INSERT INTO lots VALUES(1,1,1,'LOTE-1',NULL,10,300000,1,'Proveedor','','2026-11-06T12:00:00.000Z',10,NULL,'Activo');
    CREATE TABLE sales(id INTEGER PRIMARY KEY,business_id INTEGER,number INTEGER,user_id INTEGER,cash_id INTEGER,customer_id INTEGER,created TEXT,total INTEGER,dairy_total INTEGER,cost INTEGER,debt INTEGER,original_debt INTEGER,due TEXT,request_id TEXT UNIQUE,quote_id INTEGER,cash_received INTEGER,change_given INTEGER,status TEXT DEFAULT 'active');
    CREATE TABLE sale_lines(id INTEGER PRIMARY KEY,sale_id INTEGER,product_id INTEGER,name TEXT,sku TEXT,unit TEXT,qty INTEGER,price INTEGER,total INTEGER,cost INTEGER,allocations TEXT,price_basis INTEGER);
    CREATE TABLE stock_moves(id INTEGER PRIMARY KEY,business_id INTEGER,product_id INTEGER,lot_id INTEGER,user_id INTEGER,created TEXT,qty INTEGER,kind TEXT,reference TEXT,cost INTEGER,cost_basis INTEGER,balance_before INTEGER,balance_after INTEGER,note TEXT,request_id TEXT);
    CREATE UNIQUE INDEX idx_stock_moves_request ON stock_moves(business_id,request_id) WHERE request_id IS NOT NULL;
    CREATE TABLE payments(id INTEGER PRIMARY KEY,business_id INTEGER,sale_id INTEGER,cash_id INTEGER,user_id INTEGER,created TEXT,method TEXT,amount INTEGER,kind TEXT,reference TEXT);
    CREATE TABLE audit(id INTEGER PRIMARY KEY,business_id INTEGER,user_id INTEGER,created TEXT,action TEXT,detail TEXT);
  `);
  const request='venta-cloud-idempotente-0001',payload={request_id:request,lines:[{product_id:1,qty:3}],payments:[{method:'Efectivo',amount:15000}]},user={id:3,role:'admin'};
  const first=await storeCommand(db,user,1,'sale',payload),second=await storeCommand(db,user,1,'sale',payload);
  assert.equal(first.id,second.id);
  assert.equal(db.db.prepare('SELECT qty FROM lots WHERE id=1').get().qty,7);
  assert.deepEqual({...db.db.prepare('SELECT qty,balance_before,balance_after,cost,cost_basis FROM stock_moves').get()},{qty:-3,balance_before:10,balance_after:7,cost:300000,cost_basis:1});
  assert.equal(db.db.prepare('SELECT COUNT(*) count FROM sales').get().count,1);
  assert.equal(db.db.prepare('SELECT COUNT(*) count FROM stock_moves').get().count,1);
});

test('D1 filtra movimientos por coincidencia de producto fecha y tipo',async()=>{
  const db=new SQLiteD1();
  db.db.exec(`
    CREATE TABLE products(id INTEGER PRIMARY KEY,business_id INTEGER,sku TEXT,barcode TEXT,name TEXT,unit TEXT);
    INSERT INTO products VALUES(1,1,'SKU-ORIGINAL','770123','SHAMPOO JÓHNSONS ORIGINAL 25ML','und'),(2,1,'SKU-ARROZ','770999','ARROZ BLANQUITA','und');
    CREATE TABLE lots(id INTEGER PRIMARY KEY,business_id INTEGER,product_id INTEGER,code TEXT,qty INTEGER);
    INSERT INTO lots VALUES(1,1,1,'LOTE-A',3),(2,1,2,'LOTE-B',2);
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT);
    INSERT INTO users VALUES(3,'Administrador');
    CREATE TABLE stock_moves(id INTEGER PRIMARY KEY,business_id INTEGER,product_id INTEGER,lot_id INTEGER,user_id INTEGER,created TEXT,qty INTEGER,kind TEXT,reference TEXT,cost INTEGER,cost_basis INTEGER,balance_before INTEGER,balance_after INTEGER,note TEXT,request_id TEXT);
    INSERT INTO stock_moves VALUES(1,1,1,1,3,'2026-11-06T15:00:00.000Z',-1,'Venta','VTA-1',100000,1,3,2,'','mov-1'),(2,1,2,2,3,'2026-11-06T16:00:00.000Z',2,'Compra','COMP-1',150000,1,0,2,'','mov-2');
    CREATE VIRTUAL TABLE product_search USING fts5(product_id UNINDEXED,business_id UNINDEXED,name,sku,barcode,description);
    INSERT INTO product_search VALUES(1,1,'shampoo johnsons original 25ml','sku original','770123',''),(2,1,'arroz blanquita','sku arroz','770999','');
  `);
  const result=await stockHistory(db,{role:'admin'},1,'2026-11-06','2026-11-06',{search:'ORIGINAL',kind:'Venta'});
  assert.equal(result.stock_moves.length,1);assert.equal(result.stock_moves[0].product_id,1);assert.equal(result.stock_moves[0].kind,'Venta');
  const none=await stockHistory(db,{role:'admin'},1,'2026-11-05','2026-11-05',{search:'ORIGINAL',kind:'Venta'});
  assert.equal(none.stock_moves.length,0);
});

test('D1 permite abonar antes del vencimiento y bloquea pagos superiores',async()=>{
  const db=new SQLiteD1();
  db.db.exec(`
    CREATE TABLE cloud_revision(id INTEGER PRIMARY KEY,version INTEGER NOT NULL);
    INSERT INTO cloud_revision VALUES(1,0);
    CREATE TABLE cash_sessions(id INTEGER PRIMARY KEY,business_id INTEGER,user_id INTEGER,closed TEXT,opening INTEGER);
    INSERT INTO cash_sessions VALUES(1,1,3,NULL,0);
    CREATE TABLE sales(id INTEGER PRIMARY KEY,business_id INTEGER,status TEXT,debt INTEGER,due TEXT);
    INSERT INTO sales VALUES(8,1,'active',1000000,'2099-12-31');
    CREATE TABLE receivables(id INTEGER PRIMARY KEY,business_id INTEGER,customer_id INTEGER,sale_id INTEGER,paid_amount INTEGER,balance INTEGER,status TEXT);
    INSERT INTO receivables VALUES(5,1,4,8,0,1000000,'Pendiente');
    CREATE TABLE payments(id INTEGER PRIMARY KEY,business_id INTEGER,sale_id INTEGER,cash_id INTEGER,user_id INTEGER,created TEXT,method TEXT,amount INTEGER,kind TEXT,reference TEXT);
    CREATE TABLE cash_moves(id INTEGER PRIMARY KEY,cash_id INTEGER,amount INTEGER);
    CREATE TABLE receivable_moves(id INTEGER PRIMARY KEY,receivable_id INTEGER,business_id INTEGER,customer_id INTEGER,sale_id INTEGER,payment_id INTEGER,created TEXT,kind TEXT,amount INTEGER,balance_after INTEGER,user_id INTEGER,note TEXT,request_id TEXT);
    CREATE TABLE audit(id INTEGER PRIMARY KEY,business_id INTEGER,user_id INTEGER,created TEXT,action TEXT,detail TEXT);
  `);
  const user={id:3,role:'admin'};
  await storeCommand(db,user,1,'repay',{sale_id:8,amount:4000,method:'Nequi',request_id:'abono-futuro-1'});
  assert.equal(db.db.prepare('SELECT debt FROM sales WHERE id=8').get().debt,600000);
  await assert.rejects(storeCommand(db,user,1,'repay',{sale_id:8,amount:6001,method:'Efectivo',request_id:'abono-futuro-2'}),/Abono o medio inválido/);
  await storeCommand(db,user,1,'repay',{sale_id:8,amount:6000,method:'Efectivo',request_id:'abono-futuro-3'});
  assert.deepEqual({...db.db.prepare('SELECT paid_amount,balance,status FROM receivables WHERE id=5').get()},{paid_amount:1000000,balance:0,status:'Pagado'});
});

test('D1 repara una venta fiada antigua sin receivable antes de cobrar',async()=>{
  const db=new SQLiteD1();
  db.db.exec(`
    CREATE TABLE cloud_revision(id INTEGER PRIMARY KEY,version INTEGER NOT NULL); INSERT INTO cloud_revision VALUES(1,0);
    CREATE TABLE cash_sessions(id INTEGER PRIMARY KEY,business_id INTEGER,user_id INTEGER,closed TEXT,opening INTEGER); INSERT INTO cash_sessions VALUES(1,1,3,NULL,0);
    CREATE TABLE customers(id INTEGER PRIMARY KEY,business_id INTEGER,name TEXT); INSERT INTO customers VALUES(4,1,'Cliente legado');
    CREATE TABLE sales(id INTEGER PRIMARY KEY,business_id INTEGER,customer_id INTEGER,debt INTEGER,original_debt INTEGER,status TEXT,created TEXT,user_id INTEGER);
    INSERT INTO sales VALUES(8,1,4,1000000,1000000,'active','2026-11-03T10:00:00Z',3);
    CREATE TABLE receivables(id INTEGER PRIMARY KEY,business_id INTEGER,customer_id INTEGER,sale_id INTEGER,created TEXT,original_amount INTEGER,paid_amount INTEGER,returned_amount INTEGER,balance INTEGER,status TEXT);
    CREATE TABLE collections(id INTEGER PRIMARY KEY,business_id INTEGER,customer_id INTEGER,cash_id INTEGER,user_id INTEGER,created TEXT,amount INTEGER,method TEXT,reference TEXT,request_id TEXT);
    CREATE TABLE collection_allocations(id INTEGER PRIMARY KEY,collection_id INTEGER,receivable_id INTEGER,sale_id INTEGER,amount INTEGER,balance_after INTEGER);
    CREATE TABLE payments(id INTEGER PRIMARY KEY,business_id INTEGER,sale_id INTEGER,cash_id INTEGER,user_id INTEGER,created TEXT,method TEXT,amount INTEGER,kind TEXT,reference TEXT);
    CREATE TABLE receivable_moves(id INTEGER PRIMARY KEY,receivable_id INTEGER,business_id INTEGER,customer_id INTEGER,sale_id INTEGER,payment_id INTEGER,created TEXT,kind TEXT,amount INTEGER,balance_after INTEGER,user_id INTEGER,note TEXT,request_id TEXT);
    CREATE TABLE audit(id INTEGER PRIMARY KEY,business_id INTEGER,user_id INTEGER,created TEXT,action TEXT,detail TEXT);
  `);
  const result=await storeCommand(db,{id:3,role:'admin'},1,'customer_payment',{customer_id:4,amount:4000,method:'Nequi',request_id:'legacy-payment-123456'});
  assert.ok(result.id);
  assert.deepEqual({...db.db.prepare('SELECT original_amount,paid_amount,balance,status FROM receivables WHERE sale_id=8').get()},{original_amount:1000000,paid_amount:400000,balance:600000,status:'Parcialmente pagado'});
  assert.equal(db.db.prepare('SELECT debt FROM sales WHERE id=8').get().debt,600000);
});

test('D1 guarda En reparto, Entregado y la reapertura del despacho',async()=>{
  const db=new LogisticsD1(),user={id:3,role:'admin'};
  await logisticsCommand(db,user,1,'status',{id:7,status:'En reparto'});
  assert.equal(db.dispatch.status,'En reparto');
  assert.deepEqual(db.lines.map(line=>line.delivered_qty),[0,0]);

  await logisticsCommand(db,user,1,'status',{id:7,status:'Entregado'});
  assert.equal(db.dispatch.status,'Entregado');
  assert.deepEqual(db.lines.map(line=>line.delivered_qty),[3,5]);
  assert.equal(db.dispatch.confirmed_by,3);
  assert.ok(db.dispatch.delivered_at);

  await logisticsCommand(db,user,1,'status',{id:7,status:'Pendiente'});
  assert.equal(db.dispatch.status,'Pendiente');
  assert.deepEqual(db.lines.map(line=>line.delivered_qty),[0,0]);
  assert.equal(db.dispatch.confirmed_by,null);
  assert.equal(db.dispatch.delivered_at,null);
  assert.deepEqual(db.history.map(item=>item.to_status),['En reparto','Entregado','Pendiente']);
  assert.equal(db.audit.length,3);
});

test('D1 crea un despacho completo desde una venta',async()=>{
  const db=new SQLiteD1();
  db.db.exec(`
    CREATE TABLE cloud_revision(id INTEGER PRIMARY KEY,version INTEGER NOT NULL);
    INSERT INTO cloud_revision VALUES(1,0);
    CREATE TABLE users(id INTEGER PRIMARY KEY,name TEXT);
    INSERT INTO users VALUES(3,'Admin');
    CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT,phone TEXT);
    INSERT INTO customers VALUES(2,'Cliente prueba','3001234567');
    CREATE TABLE sales(id INTEGER PRIMARY KEY,business_id INTEGER,number INTEGER,created TEXT,status TEXT,customer_id INTEGER);
    INSERT INTO sales VALUES(5,1,15,'2026-10-09T00:30:00Z','active',2);
    CREATE TABLE sale_lines(id INTEGER PRIMARY KEY,sale_id INTEGER,product_id INTEGER,name TEXT,sku TEXT,unit TEXT,qty INTEGER,price INTEGER,price_basis INTEGER);
    INSERT INTO sale_lines VALUES(9,5,4,'Aguacate','VER-AGUACATE','g',500,800000,500);
    CREATE TABLE sales_returns(id INTEGER PRIMARY KEY);
    CREATE TABLE sales_return_lines(id INTEGER PRIMARY KEY,return_id INTEGER,sale_line_id INTEGER,qty INTEGER);
    CREATE TABLE dispatches(id INTEGER PRIMARY KEY,business_id INTEGER,number INTEGER,sale_id INTEGER,created TEXT,scheduled_date TEXT,scheduled_time TEXT,contact_phone TEXT,recipient_name TEXT,recipient_phone TEXT,address TEXT,neighborhood TEXT,city TEXT,department TEXT,reference_point TEXT,address_note TEXT,instructions TEXT,responsible TEXT,driver TEXT,vehicle_plate TEXT,note TEXT,status TEXT,delivered_at TEXT,received_by TEXT,delivery_note TEXT,confirmed_by INTEGER,created_by INTEGER,request_id TEXT);
    CREATE TABLE dispatch_lines(id INTEGER PRIMARY KEY,dispatch_id INTEGER,sale_line_id INTEGER,product_id INTEGER,name TEXT,sku TEXT,unit TEXT,qty INTEGER,delivered_qty INTEGER);
    CREATE TABLE dispatch_history(id INTEGER PRIMARY KEY,dispatch_id INTEGER,created TEXT,user_id INTEGER,from_status TEXT,to_status TEXT,note TEXT);
    CREATE TABLE audit(id INTEGER PRIMARY KEY,business_id INTEGER,user_id INTEGER,created TEXT,action TEXT,detail TEXT);
  `);
  const result=await logisticsCommand(db,{id:3,role:'admin'},1,'create',{sale_id:5,scheduled_date:'2026-10-09',responsible:'Ana',address:'Calle 1',request_id:'12345678-1234-1234-1234-123456789012',lines:[{sale_line_id:9,qty:250}]});
  assert.equal(result.ok,true);
  assert.equal(db.db.prepare('SELECT COUNT(*) n FROM dispatches').get().n,1);
  assert.deepEqual({...db.db.prepare('SELECT sale_line_id,qty,delivered_qty FROM dispatch_lines').get()},{sale_line_id:9,qty:250,delivered_qty:0});
  assert.equal(db.db.prepare('SELECT to_status FROM dispatch_history').get().to_status,'Pendiente');
});

test('D1 excluye del estado de cuenta las facturas completamente pagadas',async()=>{
  const db=new SQLiteD1();
  db.db.exec(`
    CREATE TABLE customers(id INTEGER PRIMARY KEY,business_id INTEGER,name TEXT,document TEXT);
    INSERT INTO customers VALUES(1,1,'Cliente','123');
    CREATE TABLE sales(id INTEGER PRIMARY KEY,business_id INTEGER,number INTEGER,created TEXT,total INTEGER,original_debt INTEGER,debt INTEGER,due TEXT,status TEXT,customer_id INTEGER);
    INSERT INTO sales VALUES(10,1,10,'2026-11-01T12:00:00Z',500000,500000,0,'2026-11-15','active',1),(11,1,11,'2026-11-09T12:00:00Z',800000,800000,300000,'2026-11-20','active',1);
    CREATE TABLE receivables(id INTEGER PRIMARY KEY,sale_id INTEGER,balance INTEGER,paid_amount INTEGER,returned_amount INTEGER,status TEXT);
    INSERT INTO receivables VALUES(1,10,0,500000,0,'Pagado'),(2,11,300000,500000,0,'Parcialmente pagado');
    CREATE TABLE sale_lines(id INTEGER PRIMARY KEY,sale_id INTEGER,name TEXT,unit TEXT,qty INTEGER,price INTEGER,total INTEGER,price_basis INTEGER);
    INSERT INTO sale_lines VALUES(1,10,'Producto viejo','und',1,500000,500000,1),(2,11,'Producto actual','und',1,800000,800000,1);
    CREATE TABLE unregistered_sale_lines(id INTEGER PRIMARY KEY,sale_id INTEGER,description TEXT,unit TEXT,qty INTEGER,price INTEGER,total INTEGER);
    CREATE TABLE dairy_products(id INTEGER PRIMARY KEY,name TEXT,unit TEXT);
    CREATE TABLE dairy_sale_lines(id INTEGER PRIMARY KEY,sale_id INTEGER,product_id INTEGER,qty INTEGER,price INTEGER,total INTEGER,status TEXT);
  `);
  const statement=await customerStatement(db,{id:1,role:'admin'},1,1);
  assert.deepEqual(statement.sales.map(sale=>sale.id),[11]);
  assert.equal(statement.payments,500000);assert.equal(statement.balance,300000);
});

test('D1 crea reduce y elimina reservas de lácteos',async()=>{
  const db=new SQLiteD1();
  db.db.exec(`
    CREATE TABLE cloud_revision(id INTEGER PRIMARY KEY,version INTEGER NOT NULL);INSERT INTO cloud_revision VALUES(1,0);
    CREATE TABLE dairy_permissions(user_id INTEGER PRIMARY KEY,can_view INTEGER,can_price INTEGER,can_void INTEGER,can_close INTEGER,can_reopen INTEGER);INSERT INTO dairy_permissions VALUES(3,1,1,1,1,1);
    CREATE TABLE dairy_products(id INTEGER PRIMARY KEY,code TEXT,name TEXT,unit TEXT,price INTEGER,active INTEGER);INSERT INTO dairy_products VALUES(1,'LECHE','Leche','litro',300000,1),(2,'QUESO','Queso','libra',1200000,1);
    CREATE TABLE dairy_reservations(id INTEGER PRIMARY KEY,product_id INTEGER,qty INTEGER,customer_name TEXT,phone TEXT,note TEXT,created TEXT,user_id INTEGER,status TEXT,sale_id INTEGER,updated TEXT,request_id TEXT UNIQUE);
    CREATE TABLE audit(id INTEGER PRIMARY KEY,business_id INTEGER,user_id INTEGER,created TEXT,action TEXT,detail TEXT);
  `);
  const user={id:3,role:'admin'},created=await dairyCommand(db,user,'reservation',{product_id:1,qty:3,customer_name:'Ana',request_id:'reservation-unique-1'});
  await dairyCommand(db,user,'reservation_reduce',{id:created.id,qty:2});
  assert.deepEqual({...db.db.prepare('SELECT qty,status FROM dairy_reservations WHERE id=?').get(created.id)},{qty:2,status:'Pendiente'});
  await dairyCommand(db,user,'reservation_delete',{id:created.id});
  assert.equal(db.db.prepare('SELECT status FROM dairy_reservations WHERE id=?').get(created.id).status,'Eliminada');
});
