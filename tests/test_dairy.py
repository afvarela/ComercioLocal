import sys,unittest,uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import Store,today
from dairy import dairy_command,dairy_state

class DairyTests(unittest.TestCase):
 def setUp(self):
  self.path=Path(__file__).parent/f'.dairy-{uuid.uuid4().hex}.sqlite3';self.store=Store(self.path,seed_catalog=False)
  self.store.setup({'username':'admin','name':'Admin','password':'1234'});self.user=self.store.user(self.store.login({'username':'admin','password':'1234'}))
  self.product=self.store.command(self.user,1,'product',{'sku':'PAN','name':'Pan','unit':'und','price':2000})['id']
  self.store.command(self.user,1,'initial_stock',{'product_id':self.product,'qty':10,'cost':1000});self.store.command(self.user,1,'open_cash',{'opening':0})
  dairy_command(self.store,self.user,'price',{'product_id':1,'price':3000});dairy_command(self.store,self.user,'price',{'product_id':2,'price':12000})
 def tearDown(self):
  for suffix in ('','-wal','-shm'): Path(str(self.path)+suffix).unlink(missing_ok=True)
 def test_mixed_sale_is_separate_from_inventory_sales_and_cash(self):
  result=self.store.command(self.user,1,'sale',{'request_id':uuid.uuid4().hex,'lines':[{'product_id':self.product,'qty':2}],'dairy_lines':[{'product_id':1,'qty':1.5},{'product_id':2,'qty':.5}],'payments':[{'method':'Efectivo','amount':14500}]})
  with self.store.connect() as db:
   sale=dict(db.execute('SELECT total,dairy_total,cost FROM sales WHERE id=?',(result['id'],)).fetchone());stock=db.execute('SELECT SUM(qty) FROM lots WHERE product_id=?',(self.product,)).fetchone()[0];payment=db.execute('SELECT SUM(amount) FROM payments WHERE sale_id=?',(result['id'],)).fetchone()[0]
  self.assertEqual(sale,{'total':400000,'dairy_total':1050000,'cost':200000});self.assertEqual(stock,8);self.assertEqual(payment,400000)
  state=dairy_state(self.store,self.user,today(),today());self.assertEqual(state['summary']['milk_qty'],1500);self.assertEqual(state['summary']['cheese_qty'],500);self.assertEqual(state['summary']['total'],1050000);self.assertIn('Efectivo: 14500.00',state['lines'][0]['payment_methods'])
  self.assertEqual(self.store.analytics(self.user,1,today(),today())['summary']['sales'],400000)
  with self.store.connect() as db:self.assertEqual(self.store.expected(db,self.store.cash(db,1)),400000)
 def test_prices_history_returns_close_and_reopen(self):
  sale=self.store.command(self.user,1,'sale',{'request_id':uuid.uuid4().hex,'lines':[],'dairy_lines':[{'product_id':1,'qty':1.25}],'payments':[{'method':'Nequi','amount':3750}]})['id']
  dairy_command(self.store,self.user,'price',{'product_id':1,'price':4000})
  state=dairy_state(self.store,self.user);line=state['lines'][0];self.assertEqual((line['qty'],line['price'],line['total']),(1250,300000,375000))
  dairy_command(self.store,self.user,'return',{'line_id':line['id'],'qty':.25,'reason':'Devolución','request_id':uuid.uuid4().hex})
  self.assertEqual(dairy_state(self.store,self.user)['summary']['total'],300000)
  closed=dairy_command(self.store,self.user,'close',{'day':today(),'counted':3000});self.assertEqual(closed['difference'],0)
  with self.assertRaises(ValueError): self.store.command(self.user,1,'sale',{'request_id':uuid.uuid4().hex,'lines':[],'dairy_lines':[{'product_id':1,'qty':1}],'payments':[{'method':'Efectivo','amount':4000}]})
  dairy_command(self.store,self.user,'reopen',{'day':today(),'reason':'Corrección autorizada'})
  self.assertEqual(dairy_state(self.store,self.user)['closures'][0]['status'],'reopened')

if __name__=='__main__':unittest.main()
