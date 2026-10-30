CREATE TABLE IF NOT EXISTS unregistered_options(
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(business_id,name)
);
INSERT OR IGNORE INTO unregistered_options(business_id,name) SELECT id,'OTROS' FROM businesses;
INSERT OR IGNORE INTO unregistered_options(business_id,name) SELECT id,'DULCES DETAL' FROM businesses;
INSERT OR IGNORE INTO unregistered_options(business_id,name) SELECT id,'PAPELERIA' FROM businesses;
ALTER TABLE unregistered_sale_lines ADD COLUMN option_id INTEGER REFERENCES unregistered_options(id);
ALTER TABLE unregistered_sale_lines ADD COLUMN note TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_unregistered_options_business ON unregistered_options(business_id,active,name);
CREATE INDEX IF NOT EXISTS idx_sale_lines_sale_product ON sale_lines(sale_id,product_id);
CREATE INDEX IF NOT EXISTS idx_payments_business_sale_method ON payments(business_id,sale_id,method,created);
CREATE INDEX IF NOT EXISTS idx_products_business_category ON products(business_id,category,active);
