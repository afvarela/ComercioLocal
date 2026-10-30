-- Catálogo incremental e índices para reducir lecturas D1.
-- Migración aditiva: no elimina ni reescribe productos, ventas o inventario.
CREATE TABLE IF NOT EXISTS catalog_changes(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL,
  product_id INTEGER NOT NULL,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_catalog_changes_business_id ON catalog_changes(business_id,id);
CREATE INDEX IF NOT EXISTS idx_products_catalog_page ON products(business_id,active,id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(business_id,active,name COLLATE NOCASE,id);
CREATE INDEX IF NOT EXISTS idx_products_category_name ON products(business_id,active,category,name,id);
CREATE INDEX IF NOT EXISTS idx_lots_product_available ON lots(business_id,product_id,expires,qty);
CREATE INDEX IF NOT EXISTS idx_sales_customer_status ON sales(customer_id,status);
CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_lines_sale ON sale_lines(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_lines_product ON sale_lines(product_id,sale_id);
CREATE INDEX IF NOT EXISTS idx_cash_moves_cash ON cash_moves(cash_id);
CREATE INDEX IF NOT EXISTS idx_quotes_business_id ON quotes(business_id,id DESC);
CREATE INDEX IF NOT EXISTS idx_dairy_payments_sale ON dairy_payments(sale_id);
CREATE INDEX IF NOT EXISTS idx_payments_business_date ON payments(business_id,created);
CREATE INDEX IF NOT EXISTS idx_cash_moves_business_date ON cash_moves(business_id,created);
CREATE INDEX IF NOT EXISTS idx_audit_business_date ON audit(business_id,created);
CREATE INDEX IF NOT EXISTS idx_receivable_moves_business_date ON receivable_moves(business_id,created);

INSERT INTO catalog_changes(business_id,product_id)
SELECT p.business_id,p.id FROM products p WHERE NOT EXISTS(SELECT 1 FROM catalog_changes);
CREATE TRIGGER IF NOT EXISTS catalog_products_insert AFTER INSERT ON products BEGIN
  INSERT INTO catalog_changes(business_id,product_id) VALUES(NEW.business_id,NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS catalog_products_update AFTER UPDATE ON products BEGIN
  INSERT INTO catalog_changes(business_id,product_id) VALUES(NEW.business_id,NEW.id);
END;
CREATE TRIGGER IF NOT EXISTS catalog_products_delete AFTER DELETE ON products BEGIN
  INSERT INTO catalog_changes(business_id,product_id) VALUES(OLD.business_id,OLD.id);
END;
CREATE TRIGGER IF NOT EXISTS catalog_lots_insert AFTER INSERT ON lots BEGIN
  INSERT INTO catalog_changes(business_id,product_id) VALUES(NEW.business_id,NEW.product_id);
END;
CREATE TRIGGER IF NOT EXISTS catalog_lots_update AFTER UPDATE ON lots BEGIN
  INSERT INTO catalog_changes(business_id,product_id) VALUES(NEW.business_id,NEW.product_id);
END;
CREATE TRIGGER IF NOT EXISTS catalog_lots_delete AFTER DELETE ON lots BEGIN
  INSERT INTO catalog_changes(business_id,product_id) VALUES(OLD.business_id,OLD.product_id);
END;
