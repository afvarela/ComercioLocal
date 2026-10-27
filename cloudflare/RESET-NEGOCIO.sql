-- REINICIO DEL NEGOCIO EN D1
-- Conserva: businesses, products, cloud_meta, cloud_revision y migraciones.
-- Elimina: usuarios, clientes, inventario/lotes, caja, compras, ventas y reportes.
-- Después de ejecutarlo, abra la aplicación CON INTERNET para crear el nuevo administrador.

DELETE FROM collection_allocations;
DELETE FROM finance_invoice_payments;
DELETE FROM finance_payroll_payments;
DELETE FROM finance_profit_payouts;
DELETE FROM finance_reinvestment_uses;
DELETE FROM finance_reconciliations;
DELETE FROM finance_movements;
DELETE FROM finance_invoices;
DELETE FROM finance_payrolls;
DELETE FROM finance_employees;
DELETE FROM finance_beneficiaries;
DELETE FROM finance_profits;
DELETE FROM receivable_moves;
DELETE FROM sales_return_lines;
DELETE FROM purchase_return_lines;
DELETE FROM unregistered_sale_lines;
DELETE FROM email_queue;
DELETE FROM document_emails;
DELETE FROM payments;
DELETE FROM cash_moves;
DELETE FROM stock_moves;
DELETE FROM sale_lines;
DELETE FROM collections;
DELETE FROM receivables;
DELETE FROM sales_returns;
DELETE FROM purchase_returns;
DELETE FROM purchase_lines;
DELETE FROM sales;
DELETE FROM quotes;
DELETE FROM purchases;
DELETE FROM lots;
DELETE FROM customers;
DELETE FROM cash_sessions;
DELETE FROM audit;

DELETE FROM cloud_receipts;
DELETE FROM cloud_jobs;
DELETE FROM cloud_attempts;
DELETE FROM cloud_sessions;
DELETE FROM sessions;
DELETE FROM finance_permissions;
DELETE FROM users;

UPDATE products SET current_cost = 0;
UPDATE finance_accounts SET opening_balance = 0, active = 1;
UPDATE finance_settings SET distribution_pct = 3000, reinvestment_pct = 1700, updated_by = NULL, updated_at = NULL;
