CREATE TABLE IF NOT EXISTS dispatches(
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  number INTEGER NOT NULL,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  created TEXT NOT NULL,
  scheduled_date TEXT NOT NULL,
  scheduled_time TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  recipient_name TEXT NOT NULL DEFAULT '',
  recipient_phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  neighborhood TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  reference_point TEXT NOT NULL DEFAULT '',
  address_note TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  responsible TEXT NOT NULL DEFAULT '',
  driver TEXT NOT NULL DEFAULT '',
  vehicle_plate TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Pendiente',
  delivered_at TEXT,
  received_by TEXT NOT NULL DEFAULT '',
  delivery_note TEXT NOT NULL DEFAULT '',
  confirmed_by INTEGER REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  request_id TEXT NOT NULL,
  UNIQUE(business_id,number),
  UNIQUE(business_id,request_id)
);
CREATE INDEX IF NOT EXISTS idx_dispatches_business_date ON dispatches(business_id,created);

CREATE TABLE IF NOT EXISTS dispatch_lines(
  id INTEGER PRIMARY KEY,
  dispatch_id INTEGER NOT NULL REFERENCES dispatches(id),
  sale_line_id INTEGER NOT NULL REFERENCES sale_lines(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  name TEXT NOT NULL,
  sku TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty INTEGER NOT NULL,
  delivered_qty INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_dispatch_lines_dispatch ON dispatch_lines(dispatch_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_lines_sale_line ON dispatch_lines(sale_line_id);

CREATE TABLE IF NOT EXISTS dispatch_history(
  id INTEGER PRIMARY KEY,
  dispatch_id INTEGER NOT NULL REFERENCES dispatches(id),
  created TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  from_status TEXT NOT NULL DEFAULT '',
  to_status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_dispatch_history_dispatch ON dispatch_history(dispatch_id,id);

CREATE TABLE IF NOT EXISTS label_settings(
  business_id INTEGER PRIMARY KEY REFERENCES businesses(id),
  format TEXT NOT NULL DEFAULT 'large',
  width_mm INTEGER NOT NULL DEFAULT 72,
  height_mm INTEGER NOT NULL DEFAULT 45,
  margin_mm INTEGER NOT NULL DEFAULT 2,
  name_size INTEGER NOT NULL DEFAULT 12,
  price_size INTEGER NOT NULL DEFAULT 22,
  barcode_height INTEGER NOT NULL DEFAULT 18,
  gap_mm INTEGER NOT NULL DEFAULT 2,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT
);
INSERT OR IGNORE INTO label_settings(business_id) SELECT id FROM businesses;
