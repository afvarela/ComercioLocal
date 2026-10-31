import {rows,one,check,clean,now,today,transaction} from './store.mjs';

const QUICK=new Set(['En reparto','Entregado','Cancelado']);
const TRANSITIONS={
  'Pendiente':new Set(['En preparacion','Entregado','Cancelado']),
  'En preparacion':new Set(['Listo para entregar','Entregado','Cancelado']),
  'Listo para entregar':new Set(['En reparto','Entregado','Entrega parcial','No entregado','Cancelado']),
  'En reparto':new Set(['Entregado','Entrega parcial','No entregado']),
  'En camino':new Set(['Entregado','Entrega parcial','No entregado']),
  'No entregado':new Set(['En reparto','Entregado','Cancelado']),
  'Entrega parcial':new Set(),
  'Entregado':new Set(['Pendiente']),
  'Cancelado':new Set(),
};

export function statusPlan(current,target){
  check(target!==current&&(QUICK.has(target)||TRANSITIONS[current]?.has(target)),'Transición de estado no permitida');
  const reset=['Pendiente','En reparto','Cancelado'].includes(target);
  return {reset,complete:target==='Entregado',delivered:target==='Entregado'||target==='Entrega parcial'};
}

export async function logisticsState(db,u,b,search='',includeProducts=true){
  const term=`%${clean(search).toLowerCase()}%`;
  const sales=await rows(db,`SELECT s.id,s.number,s.created,s.status,s.customer_id,COALESCE(c.name,'Consumidor final') customer,COALESCE(c.phone,'') phone,
    COALESCE((SELECT SUM(sl.qty-COALESCE((SELECT SUM(sr.qty) FROM sales_return_lines sr JOIN sales_returns r ON r.id=sr.return_id WHERE sr.sale_line_id=sl.id),0)-COALESCE((SELECT SUM(CASE WHEN d.status='Entrega parcial' THEN dl.delivered_qty ELSE dl.qty END) FROM dispatch_lines dl JOIN dispatches d ON d.id=dl.dispatch_id WHERE dl.sale_line_id=sl.id AND d.status!='Cancelado'),0)) FROM sale_lines sl WHERE sl.sale_id=s.id),0) pending_qty
    FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.business_id=? AND s.status='active' AND (CAST(s.number AS TEXT) LIKE ? OR lower(COALESCE(c.name,'')) LIKE ? OR COALESCE(c.phone,'') LIKE ?) ORDER BY s.id DESC LIMIT 60`,[b,term,term,term]);
  const dispatches=await rows(db,`SELECT d.*,s.number sale_number,COALESCE(c.name,'Consumidor final') customer,u.name creator,
    (SELECT COUNT(*) FROM dispatch_lines WHERE dispatch_id=d.id) line_count FROM dispatches d JOIN sales s ON s.id=d.sale_id LEFT JOIN customers c ON c.id=s.customer_id JOIN users u ON u.id=d.created_by WHERE d.business_id=? ORDER BY d.id DESC LIMIT 200`,[b]);
  const dispatchIds=dispatches.map(item=>item.id),dispatchLines=dispatchIds.length?await rows(db,`SELECT * FROM dispatch_lines WHERE dispatch_id IN (${dispatchIds.map(()=>'?').join(',')}) ORDER BY dispatch_id,id`,dispatchIds):[],linesByDispatch=new Map();for(const line of dispatchLines){if(!linesByDispatch.has(line.dispatch_id))linesByDispatch.set(line.dispatch_id,[]);linesByDispatch.get(line.dispatch_id).push(line);}for(const item of dispatches)item.lines=linesByDispatch.get(item.id)||[];
  const products=includeProducts?await rows(db,'SELECT id,sku,barcode,name,category,price FROM products WHERE business_id=? AND active=1 ORDER BY name',[b]):[];
  const label_settings=await one(db,'SELECT * FROM label_settings WHERE business_id=?',[b]);
  return {sales,dispatches,products,label_settings,permissions:{view:true,create:true,update:true,confirm:true,cancel:u.role==='admin',print:true,labels:true,configure:u.role==='admin'}};
}

async function saleOptionsWith(db,b,saleId){
  const selectOne=(sql,args)=>typeof db.one==='function'?db.one(sql,args):one(db,sql,args);
  const selectRows=(sql,args)=>typeof db.rows==='function'?db.rows(sql,args):rows(db,sql,args);
  const sale=await selectOne("SELECT s.*,COALESCE(c.name,'Consumidor final') customer,COALESCE(c.phone,'') phone FROM sales s LEFT JOIN customers c ON c.id=s.customer_id WHERE s.id=? AND s.business_id=?",[saleId,b]);
  check(sale&&sale.status==='active','Factura no disponible para despacho');
  const lines=await selectRows(`SELECT sl.*,COALESCE((SELECT SUM(sr.qty) FROM sales_return_lines sr JOIN sales_returns r ON r.id=sr.return_id WHERE sr.sale_line_id=sl.id),0) returned_qty,
    COALESCE((SELECT SUM(CASE WHEN d.status='Entrega parcial' THEN dl.delivered_qty ELSE dl.qty END) FROM dispatch_lines dl JOIN dispatches d ON d.id=dl.dispatch_id WHERE dl.sale_line_id=sl.id AND d.status!='Cancelado'),0) dispatched_qty FROM sale_lines sl WHERE sl.sale_id=? ORDER BY sl.id`,[saleId]);
  for(const line of lines)line.pending_qty=Math.max(0,line.qty-line.returned_qty-line.dispatched_qty);
  sale.lines=lines.filter(line=>line.pending_qty>0);
  return sale;
}

export const saleOptions=(db,u,b,saleId)=>saleOptionsWith(db,b,saleId);

export async function logisticsCommand(db,u,b,action,d){
  return transaction(db,async tx=>{
    if(action==='status'){
      const item=await tx.one('SELECT * FROM dispatches WHERE id=? AND business_id=?',[Number(d.id||0),b]);
      check(item,'Despacho no encontrado');
      const target=clean(d.status),plan=statusPlan(item.status,target),changed=now();
      const lines=await tx.rows('SELECT * FROM dispatch_lines WHERE dispatch_id=? ORDER BY id',[item.id]);
      let deliveredAt=plan.delivered?changed:plan.reset?null:item.delivered_at;
      let received=plan.reset||plan.complete?'':clean(d.received_by);
      let note=QUICK.has(target)||plan.reset?'':clean(d.note,1000);
      if(plan.complete)tx.run('UPDATE dispatch_lines SET delivered_qty=qty WHERE dispatch_id=?',[item.id]);
      else if(plan.reset)tx.run('UPDATE dispatch_lines SET delivered_qty=0 WHERE dispatch_id=?',[item.id]);
      else if(target==='Entrega parcial'){
        const delivered=new Map((d.lines||[]).map(line=>[Number(line.line_id),Number(line.qty)]));
        check([...delivered.values()].some(qty=>qty>0),'Indique al menos una cantidad entregada');
        for(const line of lines){const qty=delivered.get(line.id)||0;check(Number.isInteger(qty)&&qty>=0&&qty<=line.qty,'Cantidad entregada inválida');tx.run('UPDATE dispatch_lines SET delivered_qty=? WHERE id=?',[qty,line.id]);}
      }
      const confirmed=deliveredAt?u.id:plan.reset?null:item.confirmed_by;
      tx.run('UPDATE dispatches SET status=?,delivered_at=?,received_by=?,delivery_note=?,confirmed_by=? WHERE id=? AND business_id=?',[target,deliveredAt,received,note,confirmed,item.id,b]);
      await tx.insert('dispatch_history',{dispatch_id:item.id,created:changed,user_id:u.id,from_status:item.status,to_status:target,note});
      await tx.insert('audit',{business_id:b,user_id:u.id,created:changed,action:'dispatch_status',detail:JSON.stringify({id:item.id,from:item.status,to:target})});
      return {ok:true,id:item.id,status:target};
    }
    if(action==='create'){
      const request=clean(d.request_id);check(request.length>=16,'Identificador inválido');
      const old=await tx.one('SELECT id FROM dispatches WHERE business_id=? AND request_id=?',[b,request]);
      if(old)return {ok:true,id:old.id,duplicate:true};
      const sale=await saleOptionsWith(tx,b,Number(d.sale_id||0));
      const supplied=new Map((d.lines||[]).map(x=>[Number(x.sale_line_id),Number(x.qty)]).filter(([,qty])=>Number.isInteger(qty)&&qty>0));
      check(supplied.size,'Seleccione cantidades para despachar');
      const available=new Map(sale.lines.map(line=>[line.id,line]));
      for(const [id,qty] of supplied){const line=available.get(id);check(line&&qty<=line.pending_qty,'La cantidad supera el saldo pendiente');}
      const number=(await tx.one('SELECT COALESCE(MAX(number),0)+1 n FROM dispatches WHERE business_id=?',[b])).n,created=now();
      const values={business_id:b,number,sale_id:sale.id,created,scheduled_date:clean(d.scheduled_date)||today(),scheduled_time:clean(d.scheduled_time),contact_phone:clean(d.contact_phone),recipient_name:clean(d.recipient_name),recipient_phone:clean(d.recipient_phone),address:clean(d.address),neighborhood:clean(d.neighborhood),city:clean(d.city),department:clean(d.department),reference_point:clean(d.reference_point),address_note:clean(d.address_note),instructions:clean(d.instructions),responsible:clean(d.responsible),driver:clean(d.driver),vehicle_plate:clean(d.vehicle_plate),note:clean(d.note),status:'Pendiente',delivered_at:null,received_by:'',delivery_note:'',confirmed_by:null,created_by:u.id,request_id:request};
      const id=await tx.insert('dispatches',values);
      for(const [lineId,qty] of supplied){const line=available.get(lineId);await tx.insert('dispatch_lines',{dispatch_id:id,sale_line_id:lineId,product_id:line.product_id,name:line.name,sku:line.sku,unit:line.unit,qty,delivered_qty:0});}
      await tx.insert('dispatch_history',{dispatch_id:id,created,user_id:u.id,from_status:'',to_status:'Pendiente',note:'Despacho creado'});
      await tx.insert('audit',{business_id:b,user_id:u.id,created,action:'dispatch_create',detail:JSON.stringify({id,sale_id:sale.id,number})});
      return {ok:true,id};
    }
    if(action==='settings'){
      check(u.role==='admin','Solo el administrador configura etiquetas');
      const format=clean(d.format);check(['large','small','price'].includes(format),'Formato inválido');
      const names=['width_mm','height_mm','margin_mm','name_size','price_size','barcode_height','gap_mm','row_gap_mm','page_margin_mm','barcode_gap_mm'],values=names.map(name=>Number(d[name]));
      check(values.every(Number.isInteger)&&values[0]>=20&&values[0]<=80&&values[1]>=10&&values[1]<=120&&values[2]>=0&&values[2]<=8&&values[3]>=5&&values[3]<=28&&values[4]>=6&&values[4]<=42&&values[5]>=3&&values[5]<=30&&values.slice(6).every(value=>value>=0&&value<=8),'Revise las medidas');
      tx.run(`UPDATE label_settings SET format=?,${names.map(name=>name+'=?').join(',')},updated_by=?,updated_at=? WHERE business_id=?`,[format,...values,u.id,now(),b]);
      return {ok:true};
    }
    throw new Error('Operación logística inválida');
  });
}

const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>'$ '+(Number(value||0)/100).toLocaleString('es-CO',{minimumFractionDigits:2,maximumFractionDigits:2});
const labelMoney=value=>'$ '+Math.round(Number(value||0)/100).toLocaleString('es-CO',{maximumFractionDigits:0});
const CODE128_PATTERNS='212222,222122,222221,121223,121322,131222,122213,122312,132212,221213,221312,231212,112232,122132,122231,113222,123122,123221,223211,221132,221231,213212,223112,312131,311222,321122,321221,312212,322112,322211,212123,212321,232121,111323,131123,131321,112313,132113,132311,211313,231113,231311,112133,112331,132131,113123,113321,133121,313121,211331,231131,213113,213311,213131,311123,311321,331121,312113,312311,332111,314111,221411,431111,111224,111422,121124,121421,141122,141221,112214,112412,122114,122411,142112,142211,241211,221114,413111,241112,134111,111242,121142,121241,114212,124112,124211,411212,421112,421211,212141,214121,412121,111143,111341,131141,114113,114311,411113,411311,113141,114131,311141,411131,211412,211214,211232,2331112'.split(',');
function barcodeSvg(value,height){
  const text=String(value||'');check(text&&[...text].every(char=>{const code=char.charCodeAt(0);return code>=32&&code<=126;}),'El código contiene caracteres no compatibles con Code 128');
  const codes=[104,...[...text].map(char=>char.charCodeAt(0)-32)];codes.push((104+codes.slice(1).reduce((sum,code,index)=>sum+code*(index+1),0))%103,106);
  let x=10,black=true,bars='';for(const code of codes)for(const digit of CODE128_PATTERNS[code]){const width=Number(digit);if(black)bars+=`<rect x="${x}" y="1" width="${width}" height="${height*4}"/>`;x+=width;black=!black;}
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x+10} ${height*4+2}" preserveAspectRatio="none">${bars}</svg>`;
}
const wrap=(value,width=37)=>{const words=String(value??'').trim().split(/\s+/).filter(Boolean),result=[];let line='';for(const word of words){if(word.length>width){if(line){result.push(line);line='';}for(let i=0;i<word.length;i+=width)result.push(word.slice(i,i+width));continue;}const next=line?line+' '+word:word;if(next.length>width){if(line)result.push(line);line=word;}else line=next;}if(line)result.push(line);return result.length?result:[''];};
const center=(value,width=37)=>wrap(value,width).map(line=>line.padStart(Math.floor((width+line.length)/2)));

async function dispatchData(db,b,id){
  const item=await one(db,`SELECT d.*,s.number sale_number,COALESCE(c.name,'Consumidor final') customer,COALESCE(c.phone,'') customer_phone,bu.name business_name,bu.nit,bu.address business_address,bu.phone business_phone,u.name operator FROM dispatches d JOIN sales s ON s.id=d.sale_id LEFT JOIN customers c ON c.id=s.customer_id JOIN businesses bu ON bu.id=d.business_id JOIN users u ON u.id=d.created_by WHERE d.id=? AND d.business_id=?`,[id,b]);
  check(item,'Despacho no encontrado');
  item.lines=await rows(db,`SELECT dl.*,sl.price,COALESCE(sl.price_basis,CASE WHEN dl.unit='g' THEN 500 WHEN dl.unit='m' THEN 1000 ELSE 1 END) price_basis FROM dispatch_lines dl JOIN sale_lines sl ON sl.id=dl.sale_line_id WHERE dl.dispatch_id=? ORDER BY dl.id`,[id]);
  return item;
}

export async function dispatchText(db,b,id){
  const d=await dispatchData(db,b,id),width=37,separator='-'.repeat(width),code='DES-'+String(d.number).padStart(6,'0'),sale=(b===1?'MM':'FE')+'-'+String(d.sale_number).padStart(6,'0'),out=[];
  out.push(...center(d.business_name.toUpperCase(),width),...center('NIT: '+(d.nit||''),width),...center('TEL: '+(d.business_phone||''),width),...center('DIRECCION: '+(d.business_address||''),width),'',...center('COMPROBANTE DE DESPACHO',width),...center(code,width),'Factura: '+sale,'Atendió: '+d.operator,'',separator,'PRODUCTO                 VALOR');
  let total=0;
  for(const line of d.lines){const divisor=line.unit==='g'?line.price_basis:line.unit==='m'?1000:1,value=Math.round(line.qty*line.price/divisor);total+=value;const amount=money(value);for(const nameLine of wrap(line.name,24))out.push(nameLine);const qty=line.unit==='g'?`${line.qty} g`:line.unit==='m'?`${line.qty/1000} m`:`${line.qty} und`,detail=`${qty} x ${money(line.price)}${line.unit==='g'?'/libra ('+line.price_basis+' g)':''}`;out.push(...wrap(detail,width-amount.length-1).map((part,index)=>index===0?part.padEnd(width-amount.length-1)+' '+amount:part));}
  out.push(separator,('Total '+money(total)).padStart(width),separator,'',...center('INFORMACIÓN DE ENTREGA',width));
  for(const [label,value] of [['Cliente',d.customer],['Teléfono',d.contact_phone||d.customer_phone],['Dirección',d.address],['Barrio/Vereda',d.neighborhood],['Municipio',d.city],['Responsable',d.responsible],['Estado',d.status.toUpperCase()]])out.push(...wrap(`${label}: ${value||''}`,width));
  out.push('',separator,...center('RECIBIDO A SATISFACCIÓN',width),'','Firma:','_'.repeat(width-2),'','Nombre:','_'.repeat(width-2),'','Cédula:','_'.repeat(width-2),'',separator,...wrap('Este comprobante corresponde al despacho de los productos relacionados con la factura indicada.',width),'',...center('GRACIAS POR SU COMPRA',width),'','','');
  return out.join('\n');
}

export async function dispatchHtml(db,b,id){const text=await dispatchText(db,b,id);return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Despacho</title><style>@page{size:80mm auto;margin:2mm}*{box-sizing:border-box}body{width:76mm;margin:4px auto;color:#111}pre{font:10px/1.25 Consolas,"Courier New",monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}button{padding:9px;margin-bottom:8px}@media print{button{display:none}body{margin:0}}</style></head><body><button onclick="print()">Imprimir</button><pre>${escape(text)}</pre></body></html>`;}

export async function labelsHtml(db,b,payload){
  const requested=payload.items||[];check(requested.length,'Agregue productos');
  const ids=[...new Set(requested.map(item=>Number(item.product_id)))];
  const products=await rows(db,`SELECT * FROM products WHERE business_id=? AND active=1 AND id IN (${ids.map(()=>'?').join(',')})`,[b,...ids]),byId=new Map(products.map(product=>[product.id,product]));
  const settings=await one(db,'SELECT * FROM label_settings WHERE business_id=?',[b]),items=[];
  for(const raw of requested){const product=byId.get(Number(raw.product_id)),count=Number(raw.count);check(product&&Number.isInteger(count)&&count>0&&count<=500,'Producto o cantidad de etiquetas inválida');for(let i=0;i<count;i++)items.push(product);}
  const value=(name,fallback)=>Number(payload[name]??settings[name]??fallback),format=clean(payload.format)||settings.format,columns=format==='small'?2:1,width=value('width_mm',58),height=value('height_mm',38),margin=value('margin_mm',2),nameSize=value('name_size',13),priceSize=value('price_size',24),barcodeHeight=value('barcode_height',10),gap=value('gap_mm',2),rowGap=value('row_gap_mm',0),pageMargin=value('page_margin_mm',0),barcodeGap=value('barcode_gap_mm',2);check(width-gap*(columns-1)>=20,'El ancho y la separación no dejan espacio para las etiquetas');
  const cards=items.map(product=>`<article><div class="name">${escape(product.name)}</div><div class="price">${labelMoney(product.price)}</div><div class="barcode">${barcodeSvg(product.barcode||product.sku,barcodeHeight)}</div><div class="barcode-value">${escape(product.barcode||product.sku)}</div></article>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas</title><style>@page{size:${width}mm auto;margin:${pageMargin}mm}*{box-sizing:border-box}html,body{margin:0;padding:0}body{width:${width}mm;font-family:Arial;color:#000}main{width:${width}mm;display:grid;grid-template-columns:repeat(${columns},minmax(0,1fr));column-gap:${gap}mm;row-gap:${rowGap}mm;align-items:start}article{width:100%;height:${height}mm;border:1px dashed #888;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1mm;text-align:center;padding:${margin}mm;overflow:hidden;break-inside:avoid}.name{width:100%;font-size:${nameSize}px;font-weight:800;line-height:1.08;max-height:3.3em;overflow:hidden;text-transform:uppercase}.barcode-value{font-size:8px;line-height:1;max-width:100%;overflow-wrap:anywhere;letter-spacing:.25px}.price{width:100%;font-size:${priceSize}px;line-height:1;font-weight:900;margin:0;white-space:nowrap}.barcode{height:${barcodeHeight}mm;width:94%;line-height:0;margin-top:${barcodeGap}mm}.barcode svg{display:block;width:100%;height:100%}</style></head><body><main data-columns="${columns}" data-width-mm="${width}" data-page-margin-mm="${pageMargin}">${cards}</main></body></html>`;
}
