-- BORRADO MANUAL DE DATOS DE PRUEBA EN CLOUDFLARE D1
--
-- Ejecute este archivo una sola vez desde la carpeta del proyecto:
-- npx wrangler d1 execute comercio-local --remote --file cloudflare/BORRAR-DATOS-PRUEBA-MANUAL-D1.sql --config cloudflare/wrangler.jsonc
--
-- IMPORTANTE: conserva las tablas, las migraciones y los datos legales de businesses.
-- Elimina usuarios, sesiones, ventas, compras, inventario, clientes, caja,
-- despachos y movimientos contables. Despues restaura los catalogos del sistema.
-- Wrangler/D1 administra la atomicidad; no agregue BEGIN, COMMIT, SAVEPOINT ni PRAGMA.
-- REINICIO COMPLETO DE DATOS DE PRUEBA
-- Conserva la estructura, las migraciones de D1 y los datos legales de los negocios.
-- Elimina usuarios, sesiones, ventas, compras, inventario, clientes, despachos,
-- contabilidad y configuraciones operativas. Al terminar se restauran los
-- catalogos minimos del sistema.


DELETE FROM dispatch_history;
DELETE FROM dispatch_lines;
DELETE FROM dispatches;
DELETE FROM label_settings;

DELETE FROM dairy_returns;
DELETE FROM dairy_payments;
DELETE FROM dairy_sale_lines;
DELETE FROM dairy_closures;
DELETE FROM dairy_permissions;

DELETE FROM finance_profit_funding;
DELETE FROM finance_profit_payouts;
DELETE FROM finance_reinvestment_uses;
DELETE FROM finance_invoice_payments;
DELETE FROM finance_payroll_payments;
DELETE FROM finance_reconciliations;
DELETE FROM finance_movements;
DELETE FROM finance_payrolls;
DELETE FROM finance_employees;
DELETE FROM finance_invoices;
DELETE FROM finance_beneficiaries;
DELETE FROM finance_profits;
DELETE FROM finance_permissions;
DELETE FROM finance_accounts;
DELETE FROM finance_settings;

DELETE FROM collection_allocations;
DELETE FROM collections;
DELETE FROM receivable_moves;
DELETE FROM receivables;
DELETE FROM sales_return_lines;
DELETE FROM sales_returns;
DELETE FROM purchase_return_lines;
DELETE FROM purchase_returns;
DELETE FROM purchase_lines;
DELETE FROM purchases;
DELETE FROM document_emails;
DELETE FROM email_queue;
DELETE FROM unregistered_sale_lines;
DELETE FROM unregistered_options;
DELETE FROM payments;
DELETE FROM sale_lines;
DELETE FROM sales;
DELETE FROM quotes;
DELETE FROM stock_moves;
DELETE FROM cash_moves;
DELETE FROM cash_sessions;
DELETE FROM lots;
DELETE FROM customers;
DELETE FROM audit;

DELETE FROM cloud_jobs;
DELETE FROM cloud_receipts;
DELETE FROM cloud_sessions;
DELETE FROM cloud_attempts;
DELETE FROM sessions;
DELETE FROM products;
DELETE FROM users;
DELETE FROM dairy_products;

CREATE TABLE IF NOT EXISTS catalog_epochs(
  business_id INTEGER PRIMARY KEY REFERENCES businesses(id),
  epoch INTEGER NOT NULL DEFAULT 1,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO catalog_epochs(business_id,epoch)
SELECT id,1 FROM businesses;
UPDATE catalog_epochs
SET epoch=epoch+1, changed_at=CURRENT_TIMESTAMP;
DELETE FROM catalog_changes;


INSERT INTO finance_settings(business_id,distribution_pct,reinvestment_pct)
VALUES (1,3000,1700),(2,3000,1700);

INSERT INTO finance_accounts(id,business_id,name,type,opening_balance,active,shared_reference) VALUES
(101,1,'Efectivo','cash',0,1,''),(102,1,'Nequi','wallet',0,1,''),
(103,1,'Bancolombia','bank',0,1,''),(104,1,'Caja menor','petty_cash',0,1,''),
(201,2,'Efectivo','cash',0,1,''),(202,2,'Nequi','wallet',0,1,''),
(203,2,'Bancolombia','bank',0,1,''),(204,2,'Caja menor','petty_cash',0,1,'');

INSERT INTO dairy_products(id,code,name,unit,price,active) VALUES
(1,'LECHE','Leche de ordeno','litro',0,1),
(2,'QUESO','Queso campesino','libra',0,1);

INSERT INTO label_settings(business_id) SELECT id FROM businesses;

INSERT INTO unregistered_options(business_id,name,active)
SELECT id,'OTROS',1 FROM businesses;
INSERT INTO unregistered_options(business_id,name,active)
SELECT id,'DULCES DETAL',1 FROM businesses;
INSERT INTO unregistered_options(business_id,name,active)
SELECT id,'PAPELERIA',1 FROM businesses;



-- RESTAURAR CATALOGO PREDETERMINADO DE VERDURAS
-- Catalogo inicial del mini market; no modifica precios ni existencias existentes.
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-PAPA','Papa común','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/papa.jpg',0,0,0,3);
UPDATE products SET image='/images/papa.jpg', category='Verduras' WHERE business_id=1 AND sku='VER-PAPA';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-TOMATE','Tomate chonto','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/tomate.jpg',0,0,0,3);
UPDATE products SET image='/images/tomate.jpg', category='Verduras' WHERE business_id=1 AND sku='VER-TOMATE';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-CEBOLLA','Cebolla cabezona','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/cebolla-cabezona.jpg',0,0,0,3);
UPDATE products SET image='/images/cebolla-cabezona.jpg', category='Verduras' WHERE business_id=1 AND sku='VER-CEBOLLA';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-JUNCA','Cebolla larga','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/cebolla-larga.jpg',0,0,0,3);
UPDATE products SET image='/images/cebolla-larga.jpg', category='Verduras' WHERE business_id=1 AND sku='VER-JUNCA';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-ZANAHORIA','Zanahoria','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/zanahoria.jpg',0,0,0,3);
UPDATE products SET image='/images/zanahoria.jpg', category='Verduras' WHERE business_id=1 AND sku='VER-ZANAHORIA';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-ARVEJA','Arveja verde','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/arveja.jpg',0,0,0,3);
UPDATE products SET image='/images/arveja.jpg', category='Verduras' WHERE business_id=1 AND sku='VER-ARVEJA';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-HABICHUELA','Habichuela','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/habichuela.jpg',0,0,0,3);
UPDATE products SET image='/images/habichuela.jpg', category='Verduras' WHERE business_id=1 AND sku='VER-HABICHUELA';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-PEPINO','Pepino cohombro','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/pepino.jpg',0,0,0,3);
UPDATE products SET image='/images/pepino.jpg', category='Verduras' WHERE business_id=1 AND sku='VER-PEPINO';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-PIMENTON','Pimentón','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/pimenton.jpg',0,0,0,3);
UPDATE products SET image='/images/pimenton.jpg', category='Verduras' WHERE business_id=1 AND sku='VER-PIMENTON';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-REPOLLO','Repollo','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/repollo.jpg',0,0,0,3);
UPDATE products SET image='/images/repollo.jpg', category='Verduras' WHERE business_id=1 AND sku='VER-REPOLLO';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-PLATANO','Plátano verde','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/platano.svg',0,0,0,3);
UPDATE products SET image='/images/platano.svg', category='Verduras' WHERE business_id=1 AND sku='VER-PLATANO';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-BANANO','Banano','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/banano.svg',0,0,0,3);
UPDATE products SET image='/images/banano.svg', category='Verduras' WHERE business_id=1 AND sku='VER-BANANO';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-CILANTRO','Cilantro (manojo)','Venta por unidad / manojo','Verduras','und',0,0,1,1,1,'/images/cilantro.svg',0,0,0,3);
UPDATE products SET image='/images/cilantro.svg', category='Verduras' WHERE business_id=1 AND sku='VER-CILANTRO';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-AGUACATE','Aguacate','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/aguacate.svg',0,0,0,3);
UPDATE products SET image='/images/aguacate.svg', category='Verduras' WHERE business_id=1 AND sku='VER-AGUACATE';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-PAPA-AMARILLA','Papa amarilla','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/papa.jpg',0,0,0,3);
UPDATE products SET image='/images/papa.jpg', category='Verduras' WHERE business_id=1 AND sku='VER-PAPA-AMARILLA';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-PAPA-PASTUSA','Papa pastusa','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/papa.jpg',0,0,0,3);
UPDATE products SET image='/images/papa.jpg', category='Verduras' WHERE business_id=1 AND sku='VER-PAPA-PASTUSA';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-PLATANO-MADURO','Plátano maduro','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/platano-maduro.svg',0,0,0,3);
UPDATE products SET image='/images/platano-maduro.svg', category='Verduras' WHERE business_id=1 AND sku='VER-PLATANO-MADURO';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-MANGO','Mango','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/mango.svg',0,0,0,3);
UPDATE products SET image='/images/mango.svg', category='Verduras' WHERE business_id=1 AND sku='VER-MANGO';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-MANZANA','Manzana','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/manzana.svg',0,0,0,3);
UPDATE products SET image='/images/manzana.svg', category='Verduras' WHERE business_id=1 AND sku='VER-MANZANA';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-PERA','Pera','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/pera.svg',0,0,0,3);
UPDATE products SET image='/images/pera.svg', category='Verduras' WHERE business_id=1 AND sku='VER-PERA';
INSERT OR IGNORE INTO products(business_id,sku,name,description,category,unit,price,min_stock,perishable,active,price_basis,image,current_cost,max_stock,reorder_point,lead_time_days) VALUES(1,'VER-FRESA','Fresa','Venta por peso - libra de 500 g','Verduras','g',0,0,1,1,500,'/images/fresa.svg',0,0,0,3);
UPDATE products SET image='/images/fresa.svg', category='Verduras' WHERE business_id=1 AND sku='VER-FRESA';

-- RESULTADO ESPERADO: usuarios, ventas, clientes y lotes en cero.
SELECT
  (SELECT COUNT(*) FROM users) AS usuarios,
  (SELECT COUNT(*) FROM sales) AS ventas,
  (SELECT COUNT(*) FROM customers) AS clientes,
  (SELECT COUNT(*) FROM lots) AS lotes,
  (SELECT COUNT(*) FROM products) AS productos_predeterminados,
  (SELECT COUNT(*) FROM finance_accounts) AS cuentas_contables,
  (SELECT COUNT(*) FROM dairy_products) AS productos_lacteos,
  (SELECT COUNT(*) FROM businesses) AS negocios;
