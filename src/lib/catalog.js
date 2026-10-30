const DB_NAME="comercio-catalog-v1",STORE="catalogs",LOCAL="pos-catalog-snapshot-v1";
const localRead=business=>{try{return JSON.parse(localStorage.getItem(LOCAL)||'{}')[business]||null}catch{return null}};
const localWrite=(business,value)=>{let all={};try{all=JSON.parse(localStorage.getItem(LOCAL)||'{}')}catch{}all[business]=value;localStorage.setItem(LOCAL,JSON.stringify(all));};
function openDb(){return new Promise((resolve,reject)=>{if(!globalThis.indexedDB)return resolve(null);const request=indexedDB.open(DB_NAME,1);request.onupgradeneeded=()=>request.result.createObjectStore(STORE);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}
async function stored(business){const fallback=localRead(business);try{const db=await openDb();if(!db)return fallback;return await new Promise((resolve,reject)=>{const request=db.transaction(STORE).objectStore(STORE).get(String(business));request.onsuccess=()=>resolve(request.result||fallback);request.onerror=()=>reject(request.error);});}catch{return fallback;}}
async function persist(business,value){localWrite(business,value);try{const db=await openDb();if(!db)return;await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,"readwrite");tx.objectStore(STORE).put(value,String(business));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}catch{}}
const merge=(items,updates,deleted=[])=>{const map=new Map(items.map(x=>[x.id,x]));for(const id of deleted)map.delete(id);for(const item of updates)map.set(item.id,item);return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name,'es',{sensitivity:'base'}));};
export function cachedCatalog(business){return localRead(business)?.products||[];}
export async function syncCatalog(business,request,{full=false}={}){
 let saved=await stored(business)||{products:[],after:0,cursor:0,baselineCursor:0,complete:false};
 try{
  if(saved.complete&&saved.cursor>0){let page;do{page=await request(`/api/catalog?since=${saved.cursor}&limit=100`);saved={...saved,products:merge(saved.products,page.products,page.deleted),cursor:page.cursor,complete:true};await persist(business,saved);}while(page.has_more);return saved;}
  do{
   const after=Number(saved.after||0),limit=after?100:30,page=await request(`/api/catalog?after=${after}&limit=${limit}`);
   const baselineCursor=Number(saved.baselineCursor||saved.cursor||page.cursor||0);
   saved={...saved,products:merge(saved.products,page.products),after:page.after,baselineCursor,cursor:baselineCursor,complete:!page.has_more};
   await persist(business,saved);
  }while(full&&!saved.complete);
  return saved;
 }catch(error){if(saved.products.length)return {...saved,offline:true};throw error;}
}
