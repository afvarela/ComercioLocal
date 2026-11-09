CREATE TABLE IF NOT EXISTS dairy_reservations(
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL,
  qty INTEGER NOT NULL CHECK(qty>0),
  customer_name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pendiente' CHECK(status IN ('Pendiente','Vendida','Eliminada')),
  sale_id INTEGER,
  updated TEXT NOT NULL,
  request_id TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_dairy_reservations_status ON dairy_reservations(status,created);
