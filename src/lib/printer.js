import { cop, lineTotal, qty } from "./format.js";

const AGENT = "http://127.0.0.1:8768";
const KEY = "comercio-pos-printer";
const DISPATCH_KEY = "comercio-dispatch-printer";
export const selectedPrinter = () => localStorage.getItem(KEY) || "";
export const savePrinter = (name) => localStorage.setItem(KEY, name);
export const selectedDispatchPrinter = () => localStorage.getItem(DISPATCH_KEY) || selectedPrinter();
export const saveDispatchPrinter = (name) => localStorage.setItem(DISPATCH_KEY, name);
export const selectedLabelPrinter = (business) => localStorage.getItem(`comercio-label-printer-${business}`) || selectedPrinter();
export const saveLabelPrinter = (business, name) => localStorage.setItem(`comercio-label-printer-${business}`, name);
async function call(path, options) {
  const r = await fetch(AGENT + path, options);
  const result = await r.json();
  if (!r.ok) throw Error(result.error || "No se pudo usar la impresora");
  return result;
}
export const listPrinters = () => call("/printers");
export const testPrinter = (printer) =>
  call("/print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ printer, text: "COMERCIO LOCAL\nPrueba de impresión\n\n\n" }),
  });
export const testDispatchPrinter = (printer) =>
  call("/print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ printer, text: "COMPROBANTE DE DESPACHO\nPrueba de impresión\nDirección · Teléfono · Cédula\n\n\n", font_size: 7, margin_mm: 0.5, right_margin_mm: 5 }),
  });
export async function printReceipt(business, kind, id) {
  const printer = selectedPrinter();
  if (!printer) throw Error("No hay una impresora de recibos configurada en este equipo");
  const r = await fetch(`/receipt.txt?business=${business}&kind=${kind}&id=${id}`);
  if (!r.ok) throw Error("No fue posible preparar el recibo");
  return call("/print", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ printer, text: await r.text() }),
  });
}
export function accountStatementHtml(businessName, statement) {
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  const money = (value) => escape(cop(Number(value || 0)));
  const date = (value) => {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? escape(value) : escape(parsed.toLocaleDateString("es-CO", { timeZone: "America/Bogota", year: "numeric", month: "2-digit", day: "2-digit" }));
  };
  const sales = (statement.sales || []).map((sale) => {
    const saleCode = Number.isFinite(Number(sale.number)) ? String(sale.number).padStart(6, "0") : String(sale.number || "LOCAL");
    const rows = (sale.lines || []).map((item) => {
      const quantityText = `${qty(item.qty, item.unit)} ${item.unit}`;
      const basis = item.unit === "g" ? (Number(item.price_basis) === 500 ? "libra" : "kg") : item.unit;
      return `<tr><td>${escape(item.name)}</td><td>${escape(quantityText)}</td><td>${money(item.price)} / ${escape(basis)}</td><td>${money(item.total)}</td></tr>`;
    }).join("");
    return `<section class="sale"><div class="sale-head"><b>Factura #${escape(saleCode)}</b><span>Fecha: ${date(sale.created)}</span></div><table><thead><tr><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Valor</th></tr></thead><tbody>${rows}</tbody></table></section>`;
  }).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Estado de cuenta</title><style>*{box-sizing:border-box}body{font:12px Arial,sans-serif;width:72mm;margin:6mm auto;color:#111}header{text-align:center;margin-bottom:16px}h1{font-size:18px;margin:0 0 5px}h2{font-size:15px;margin:0 0 10px}.customer{line-height:1.5}.sale{border-top:1px dashed #555;padding-top:9px;margin-top:11px;break-inside:avoid}.sale-head{display:flex;justify-content:space-between;gap:8px;margin-bottom:7px}table{border-collapse:collapse;width:100%;font-size:10px;table-layout:fixed}th,td{padding:4px 2px;border-bottom:1px solid #ddd;vertical-align:top;overflow-wrap:anywhere}th{text-align:left}th:nth-child(1),td:nth-child(1){width:34%}th:nth-child(2),td:nth-child(2){width:18%}th:nth-child(3),td:nth-child(3){width:25%}th:nth-child(4),td:nth-child(4){width:23%;text-align:right}.summary{border-top:2px solid #111;margin-top:15px;padding-top:8px}.summary p{display:flex;justify-content:space-between;gap:10px;margin:5px 0}.balance{font-size:14px;font-weight:bold}.note{text-align:center;font-size:10px;margin-top:14px}@page{size:80mm auto;margin:4mm}@media print{body{margin:0;width:auto}}</style></head><body><header><h1>${escape(String(businessName).toUpperCase())}</h1><h2>ESTADO DE CUENTA</h2><div class="customer"><b>${escape(statement.customer?.name)}</b><br>CC/NIT: ${escape(statement.customer?.document || "Sin documento")}</div></header>${sales}<div class="summary"><p><span>Total fiado</span><b>${money(statement.total_credit)}</b></p><p><span>Abonos</span><b>- ${money(statement.payments)}</b></p>${statement.returns ? `<p><span>Devoluciones</span><b>- ${money(statement.returns)}</b></p>` : ""}<p class="balance"><span>Saldo pendiente</span><b>${money(statement.balance)}</b></p></div><p class="note">Estado de cuenta interno.</p></body></html>`;
}
export async function printDispatch(business, id) {
  const printer = selectedDispatchPrinter();
  if (!printer) throw Error("No hay una impresora de despachos configurada en este equipo");
  const r = await fetch(`/dispatch.txt?business=${business}&id=${id}`);
  if (!r.ok) throw Error("No fue posible preparar el comprobante de despacho");
  return call("/print", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ printer, text: await r.text(), font_size: 7, margin_mm: 0.5, right_margin_mm: 5 }) });
}
async function callLabelAgent(options) {
  try { return await call("/print-labels", options); }
  catch (first) {
    const r=await fetch("http://127.0.0.1:8778/print-labels",options),result=await r.json();
    if(!r.ok)throw Error(result.error||first.message);return result;
  }
}
function drawLabelElement(context,element,articleRect,scale=2){
  if(!element)return;
  const rect=element.getBoundingClientRect(),style=getComputedStyle(element),x=(rect.left-articleRect.left)*scale,y=(rect.top-articleRect.top)*scale,w=rect.width*scale,h=rect.height*scale,fontSize=parseFloat(style.fontSize||"10")*scale;
  context.fillStyle="#000";context.textAlign="center";context.textBaseline="middle";context.font=`${style.fontWeight||400} ${fontSize}px Arial`;
  let text=(element.textContent||"").trim();if(style.textTransform==="uppercase")text=text.toUpperCase();const words=text.split(/\s+/),lines=[];let line="";
  if(element.classList.contains("price"))lines.push(text);else{for(const word of words){const candidate=line?`${line} ${word}`:word;if(context.measureText(candidate).width>w-4&&line){lines.push(line);line=word}else line=candidate}if(line)lines.push(line)}
  const lineHeight=fontSize*1.08,start=y+h/2-(lines.length-1)*lineHeight/2;lines.slice(0,3).forEach((value,index)=>context.fillText(value,x+w/2,start+index*lineHeight,w-2));
}
function drawBarcode(context,container,articleRect,scale=2){
  const svg=container?.querySelector("svg");if(!svg)return;const rect=container.getBoundingClientRect(),view=(svg.getAttribute("viewBox")||"").split(/\s+/).map(Number),viewWidth=view[2]||1,viewHeight=view[3]||1,x0=(rect.left-articleRect.left)*scale,y0=(rect.top-articleRect.top)*scale,w=rect.width*scale,h=rect.height*scale;
  context.fillStyle="#000";for(const bar of svg.querySelectorAll("rect")){const x=Number(bar.getAttribute("x")||0),y=Number(bar.getAttribute("y")||0),bw=Number(bar.getAttribute("width")||0),bh=Number(bar.getAttribute("height")||0);context.fillRect(x0+x/viewWidth*w,y0+y/viewHeight*h,Math.max(1,bw/viewWidth*w),bh/viewHeight*h)}
}
export async function printLabels(business, html) {
  const printer=selectedLabelPrinter(business);
  if(!printer)throw Error("Configura la impresora de etiquetas en el diseñador");
  const frame=document.createElement("iframe");frame.style.cssText="position:fixed;left:-10000px;top:0;visibility:hidden";document.body.appendChild(frame);
  const source=URL.createObjectURL(new Blob([html],{type:"text/html"}));frame.src=source;
  await new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=reject});
  try{
    const doc=frame.contentDocument,pages=[],main=doc.querySelector("main"),articles=[...doc.querySelectorAll("article")],columns=Math.max(1,Number(main?.dataset.columns)||1),mainRect=main.getBoundingClientRect(),pixelsPerMm=mainRect.width/(Number(main?.dataset.widthMm)||80),pageMargin=Math.max(0,Number(main?.dataset.pageMarginMm)||0)*pixelsPerMm;
    for(let index=0;index<articles.length;index+=columns){
      const row=articles.slice(index,index+columns),rects=row.map(article=>article.getBoundingClientRect()),firstTop=Math.min(...rects.map(rect=>rect.top)),top=firstTop-(index===0?pageMargin:0),nextTop=articles[index+columns]?.getBoundingClientRect().top,lastBottom=Math.max(...rects.map(rect=>rect.bottom)),bottom=(nextTop??lastBottom)+(index+columns>=articles.length?pageMargin:0),origin={left:mainRect.left,top},width=Math.max(160,Math.ceil(mainRect.width*2)),height=Math.max(40,Math.ceil((bottom-top)*2)),canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;const context=canvas.getContext("2d",{willReadFrequently:true});context.fillStyle="#fff";context.fillRect(0,0,width,height);
      for(const article of row){drawLabelElement(context,article.querySelector(".name"),origin);drawLabelElement(context,article.querySelector(".price"),origin);drawBarcode(context,article.querySelector(".barcode"),origin);drawLabelElement(context,article.querySelector(".barcode-value"),origin);}
      const rgba=context.getImageData(0,0,width,height).data,gray=new Uint8Array(width*height);for(let i=0,j=0;i<rgba.length;i+=4,j++)gray[j]=rgba[i]*.299+rgba[i+1]*.587+rgba[i+2]*.114;
      let binary="";for(let i=0;i<gray.length;i+=32768)binary+=String.fromCharCode(...gray.subarray(i,i+32768));pages.push({width,height,pixels:btoa(binary)});
    }
    if(!pages.length)throw Error("No se generaron etiquetas para imprimir");
    return callLabelAgent({method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({printer,pages})});
  }finally{URL.revokeObjectURL(source);frame.remove()}
}
export async function printOfflineSale({ businessName, requestId, cart, payments, total, cashReceived = 0, change = 0 }) {
  const printer = selectedPrinter();
  if (!printer) throw Error("No hay una impresora de recibos configurada en este equipo");
  const lines = [
    "COMERCIO LOCAL", businessName, "VENTA PENDIENTE DE SINCRONIZAR",
    new Date().toLocaleString("es-CO"), `Referencia: ${requestId}`, "--------------------------------",
    ...cart.flatMap((item) => [item.name, ...(item.note ? [`Nota: ${item.note}`] : []), `${qty(item.qty, item.unit)} ${item.unit}  ${cop(lineTotal(item))}`]),
    "--------------------------------", `TOTAL: ${cop(total)}`,
    ...payments.filter((p) => Number(p.amount) > 0).map((p) => `${p.method}: ${cop(Math.round(Number(p.amount) * 100))}`),
    ...(Number(cashReceived) > 0 ? [`Efectivo recibido: ${cop(Number(cashReceived))}`] : []),
    ...(Number(change) > 0 ? [`Cambio: ${cop(Number(change))}`] : []),
    "", "Se registrara en el sistema al recuperar la conexion.", "", "",
  ];
  return call("/print", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ printer, text: lines.join("\n") }) });
}
