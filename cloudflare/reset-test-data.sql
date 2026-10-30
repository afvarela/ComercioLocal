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

-- Los navegadores usan este número para descartar el catálogo local anterior.
-- Después de invalidarlo ya no necesitamos conservar miles de eventos de
-- productos eliminados; las verduras restauradas crearán el catálogo nuevo.
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

