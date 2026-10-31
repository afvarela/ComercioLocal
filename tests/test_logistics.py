import sys,unittest,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import Store
from logistics import logistics_state,logistics_command,sale_options,dispatch_receipt,labels_html
class LogisticsTests(unittest.TestCase):
 def setUp(self):
  self.path=Path(__file__).parent/f'.logistics-{uuid.uuid4().hex}.sqlite3';self.store=Store(self.path,seed_catalog=False);self.store.setup({'username':'admin','name':'Admin','password':'1234'});self.u=self.store.user(self.store.login({'username':'admin','password':'1234'}));self.store.command(self.u,1,'open_cash',{'opening':0});self.p=self.store.command(self.u,1,'product',{'sku':'ARROZ-500','barcode':'7701234567890','name':'Arroz de prueba con nombre largo 500 gramos','description':'Arroz blanco de primera calidad','unit':'und','price':3500})['id'];self.store.command(self.u,1,'receive',{'product_id':self.p,'qty':20,'cost':2000});self.sale=self.store.command(self.u,1,'sale',{'request_id':uuid.uuid4().hex,'lines':[{'product_id':self.p,'qty':10}],'payments':[{'method':'Efectivo','amount':35000}]})['id'];self.line_id=sale_options(self.store,self.u,1,self.sale)['lines'][0]['id']
 def tearDown(self):
  for suffix in ('','-wal','-shm'):Path(str(self.path)+suffix).unlink(missing_ok=True)
 def create(self,qty,request=None):
  return logistics_command(self.store,self.u,1,'create',{'sale_id':self.sale,'scheduled_date':'2026-10-10','responsible':'Ana','address':'Calle 1','request_id':request or uuid.uuid4().hex,'lines':[{'sale_line_id':self.line_id,'qty':qty}]})
 def test_partial_then_complete_without_inventory_discount(self):
  before=self.store.state(self.u,1)['products'][0]['available'];a=self.create(6);self.assertEqual(sale_options(self.store,self.u,1,self.sale)['lines'][0]['pending_qty'],4);b=self.create(4);self.assertEqual(self.store.state(self.u,1)['products'][0]['available'],before);self.assertIn('COMPROBANTE DE DESPACHO',dispatch_receipt(self.store,1,a['id']));receipt=dispatch_receipt(self.store,1,b['id'],True);self.assertIn('RECIBIDO A SATISFACCIÓN',receipt);self.assertIn('Teléfono:',receipt);self.assertIn('Dirección:',receipt);self.assertIn('Cédula:',receipt);self.assertIn('productos',receipt);self.assertIn('relacionados',receipt)
 def test_reject_excess_and_idempotent(self):
  req=uuid.uuid4().hex;r=self.create(10,req);self.assertTrue(logistics_command(self.store,self.u,1,'create',{'sale_id':self.sale,'request_id':req})['duplicate']);self.assertEqual(r['id'],logistics_state(self.store,self.u,1)['dispatches'][0]['id'])
  with self.assertRaises(ValueError):logistics_command(self.store,self.u,1,'create',{'sale_id':self.sale,'scheduled_date':'2026-10-10','responsible':'Ana','address':'Calle 1','request_id':uuid.uuid4().hex,'lines':[{'sale_line_id':self.line_id,'qty':1}]})
 def test_status_cancel_releases_quantity(self):
  r=self.create(10);logistics_command(self.store,self.u,1,'status',{'id':r['id'],'status':'Cancelado'});self.assertEqual(sale_options(self.store,self.u,1,self.sale)['lines'][0]['pending_qty'],10)
 def test_pending_dispatch_can_be_marked_delivered_directly(self):
  dispatch=self.create(10)['id'];logistics_command(self.store,self.u,1,'status',{'id':dispatch,'status':'Entregado'})
  item=logistics_state(self.store,self.u,1)['dispatches'][0]
  self.assertEqual(item['status'],'Entregado');self.assertEqual(item['received_by'],'');self.assertTrue(item['delivered_at']);self.assertTrue(all(line['delivered_qty']==line['qty'] for line in item['lines']))
  logistics_command(self.store,self.u,1,'status',{'id':dispatch,'status':'Pendiente'});item=logistics_state(self.store,self.u,1)['dispatches'][0]
  self.assertEqual(item['status'],'Pendiente');self.assertIsNone(item['delivered_at']);self.assertIsNone(item['confirmed_by']);self.assertTrue(all(line['delivered_qty']==0 for line in item['lines']))
  logistics_command(self.store,self.u,1,'status',{'id':dispatch,'status':'Cancelado'});logistics_command(self.store,self.u,1,'status',{'id':dispatch,'status':'En reparto'});logistics_command(self.store,self.u,1,'status',{'id':dispatch,'status':'Entregado'})
  self.assertEqual(logistics_state(self.store,self.u,1)['dispatches'][0]['status'],'Entregado')
 def test_labels_multiple_copies_include_all_product_data(self):
  page=labels_html(self.store,1,{'items':[{'product_id':self.p,'count':3}],'format':'large'});self.assertEqual(page.count('<article>'),3);self.assertIn('Arroz de prueba con nombre largo 500 gramos',page);self.assertNotIn('SKU:',page);self.assertNotIn("class='sku'",page);self.assertIn('$ 3.500',page);self.assertNotIn('$ 3.500,00',page);self.assertIn('<svg',page);self.assertIn('7701234567890',page);self.assertNotIn('C&oacute;digo:',page);self.assertIn('data-columns="1"',page)
 def test_compact_labels_keep_barcode_and_configurable_cut_gaps(self):
  page=labels_html(self.store,1,{'items':[{'product_id':self.p,'count':2}],'format':'small','width_mm':50,'height_mm':12,'margin_mm':0,'name_size':6,'price_size':8,'barcode_height':3,'gap_mm':2,'row_gap_mm':1,'page_margin_mm':0,'barcode_gap_mm':2})
  self.assertIn('data-columns="2"',page);self.assertIn('column-gap:2mm',page);self.assertIn('row-gap:1mm',page);self.assertIn('height:12mm',page);self.assertIn('@page{size:50mm auto;margin:0mm',page);self.assertIn('margin-top:2mm',page);self.assertIn('white-space:nowrap',page);self.assertIn('max-height:3.3em',page);self.assertEqual(page.count('<svg'),2)
 def test_dispatch_html_uses_safe_entities_for_accents(self):
  receipt=dispatch_receipt(self.store,1,self.create(10)['id']);self.assertIn('Tel&#233;fono:',receipt);self.assertIn('Direcci&#243;n:',receipt);self.assertIn('SATISFACCI&#211;N',receipt);self.assertIn('C&#233;dula:',receipt);self.assertNotIn('Ã',receipt)
 def test_dispatch_receipt_uses_pos_width_and_complete_product_detail(self):
  dispatch=self.create(10)['id'];text=dispatch_receipt(self.store,1,dispatch,True);page=dispatch_receipt(self.store,1,dispatch)
  self.assertIn('10 und × $ 3,500.00/und',text);self.assertIn('$ 35,000.00',text);self.assertIn('Total $ 35,000.00',text);self.assertNotIn('Fecha:',text);self.assertNotIn('Hora:',text);self.assertNotIn('Observaciones:',text);self.assertTrue(all(len(line)<=37 for line in text.splitlines()))
  self.assertIn('PRODUCTO',page);self.assertIn('VALOR',page);self.assertIn('10 und',page);self.assertIn('$ 3,500.00/und',page);self.assertIn('Total $ 35,000.00',page);self.assertIn('@page{size:80mm auto;margin:2mm}',page)
 def test_dispatch_states_en_reparto_delivered_and_cancelled(self):
  first=self.create(5)['id'];logistics_command(self.store,self.u,1,'status',{'id':first,'status':'En preparacion'});logistics_command(self.store,self.u,1,'status',{'id':first,'status':'Listo para entregar'});logistics_command(self.store,self.u,1,'status',{'id':first,'status':'En reparto'});self.assertIn('Estado: EN REPARTO',dispatch_receipt(self.store,1,first,True));logistics_command(self.store,self.u,1,'status',{'id':first,'status':'Entregado','received_by':'Niño Pérez'});self.assertEqual(logistics_state(self.store,self.u,1)['dispatches'][0]['status'],'Entregado')
  second=self.create(5)['id'];logistics_command(self.store,self.u,1,'status',{'id':second,'status':'Cancelado'});self.assertEqual(logistics_state(self.store,self.u,1)['dispatches'][0]['status'],'Cancelado')
 def test_business_isolation(self):
  self.assertEqual(logistics_state(self.store,self.u,2)['dispatches'],[])
  with self.assertRaises(ValueError):sale_options(self.store,self.u,2,self.sale)
 def test_special_characters_survive_catalog_and_label_output(self):
  names=['Caña de azúcar','Piñón metálico','Conexión rápida','Tubería PVC','Cemento Argos','Niño','Muñeca','Café molido'];items=[]
  for index,name in enumerate(names):
   product=self.store.command(self.u,1,'product',{'sku':f'ESP-{index}','barcode':f'77000000000{index}','name':name,'description':f'Descripción de {name}','unit':'und','price':1000})['id'];items.append({'product_id':product,'count':1})
  state_names=[x['name'] for x in logistics_state(self.store,self.u,1)['products']];page=labels_html(self.store,1,{'items':items,'format':'large'})
  for name in names:self.assertIn(name,state_names);self.assertIn(name,page)
if __name__=='__main__':unittest.main()
