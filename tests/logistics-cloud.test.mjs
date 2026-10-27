import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {logisticsCommand} from '../cloudflare/logistics.mjs';

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
