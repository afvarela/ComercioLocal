import React,{useEffect,useState} from "react";
import {api} from "../lib/api.js";
import {cop,localDate,uid,dt} from "../lib/format.js";
import {Head,Button,Panel,Table,Metrics,Badge,Modal,Field,Notice} from "../components/UI.jsx";

export default function Dairy({business}){
 const [start,setStart]=useState(localDate()),[end,setEnd]=useState(localDate()),[data,setData]=useState(null),[form,setForm]=useState(null),[error,setError]=useState("");
 const load=async()=>{try{setData(await api(business,`/api/dairy?start=${start}&end=${end}`));setError("")}catch(e){setError(e.message)}};
 useEffect(()=>{load()},[start,end,business]);
 async function save(values){await api(business,"/api/dairy-command",{action:form.type,data:{...values,request_id:uid()}});setForm(null);await load()}
 if(error)return <Notice>{error}</Notice>;if(!data)return <div className="loading">Cargando control de lácteos…</div>;
 const p=data.permission||{},todayClosure=data.closures.find(x=>x.day===localDate()&&x.status==="closed");
 return <><Head title="Control de lácteos caseros" subtitle="Recaudo de terceros separado de las ventas e inventario del negocio."><a className="export-button" href={`/api/dairy-report.xlsx?business=1&start=${start}&end=${end}`}>Exportar Excel</a>{p.can_close&&!todayClosure&&<Button primary onClick={()=>setForm({type:"close"})}>Cuadrar el día</Button>}</Head>
 <div className="date-range"><input type="date" value={start} onChange={e=>setStart(e.target.value)}/><span>a</span><input type="date" value={end} onChange={e=>setEnd(e.target.value)}/></div>
 <div className="dairy-summary"><Metrics items={[{label:"Leche vendida",value:`${(data.summary.milk_qty/1000).toLocaleString("es-CO")} litros`,note:cop(data.summary.milk_total)},{label:"Queso vendido",value:`${(data.summary.cheese_qty/1000).toLocaleString("es-CO")} libras`,note:cop(data.summary.cheese_total)},{label:"Recaudo total",value:cop(data.summary.total),note:"Dinero de terceros"}]}/></div>
 <div className="grid2"><Panel title="Precios vigentes"><Table headers={["Producto","Unidad","Precio","Acción"]} rows={data.products.map(x=>[x.name,x.unit,cop(x.price),p.can_price?<Button onClick={()=>setForm({type:"price",item:x})}>Cambiar precio</Button>:"—"])}/></Panel><Panel title="Cuadres diarios"><Table headers={["Día","Esperado","Recibido","Diferencia","Estado","Acción"]} rows={data.closures.map(x=>[x.day,cop(x.expected),cop(x.counted),<span className={x.difference<0?"money-out":"money-in"}>{cop(x.difference)}</span>,<Badge tone={x.status==="closed"?"":"warn"}>{x.status==="closed"?"Cerrado":"Reabierto"}</Badge>,x.status==="closed"&&p.can_reopen?<Button onClick={()=>setForm({type:"reopen",item:x})}>Reabrir</Button>:"—"])}/></Panel></div>
 <Panel className="subsection" title="Detalle del recaudo"><Table headers={["Fecha y hora","Venta","Producto","Cantidad","Precio aplicado","Importe","Medio de pago","Usuario","Estado","Acción"]} rows={data.lines.map(x=>[dt(x.created),`#${x.sale_number}`,x.name,`${((x.qty-x.returned_qty)/1000).toLocaleString("es-CO")} ${x.unit}`,cop(x.price),cop(x.total-x.returned_amount),x.payment_methods,x.operator,<Badge tone={x.status==="active"?"":"red"}>{x.status==="active"?"Registrada":"Anulada"}</Badge>,x.status==="active"&&x.qty>x.returned_qty&&p.can_void?<Button onClick={()=>setForm({type:"return",item:x})}>Devolución</Button>:"—"])}/></Panel>
 {form&&<DairyForm form={form} summary={data.summary} onClose={()=>setForm(null)} onSave={save}/>}</>;
}
function DairyForm({form,summary,onClose,onSave}){
 let title,body;
 if(form.type==="price"){title=`Precio de ${form.item.name}`;body=<><input type="hidden" name="product_id" value={form.item.id}/><Field name="price" label={`Precio por ${form.item.unit}`} type="number" min="0.01" step="0.01" defaultValue={(form.item.price/100).toFixed(2)} required/></>}
 else if(form.type==="return"){title="Registrar devolución";body=<><input type="hidden" name="line_id" value={form.item.id}/><Notice info>Disponible: {(form.item.qty-form.item.returned_qty)/1000} {form.item.unit}</Notice><Field name="qty" label="Cantidad devuelta" type="number" min="0.001" step="0.001" required/><Field name="reason" label="Motivo" required/></>}
 else if(form.type==="close"){title="Cuadre diario de lácteos";body=<><Field name="day" label="Día" type="date" defaultValue={localDate()} required/><Notice info>Recaudo esperado del rango visible: {cop(summary.total)}</Notice><Field name="counted" label="Dinero realmente recibido" type="number" min="0" step="0.01" required/></>}
 else {title="Reabrir día cerrado";body=<><input type="hidden" name="day" value={form.item.day}/><Notice>Esta acción vuelve a permitir ajustes sobre el día {form.item.day}.</Notice><Field name="reason" label="Motivo de reapertura" required/></>}
 return <Modal title={title} onClose={onClose} onSubmit={onSave} submit="Guardar">{body}</Modal>;
}
