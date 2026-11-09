-- Banco contable: consolida una sola vez las ventas netas de cada caja cerrada.
CREATE TABLE IF NOT EXISTS finance_bank_closures(
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL,
  cash_id INTEGER NOT NULL,
  closed_at TEXT NOT NULL,
  efectivo INTEGER NOT NULL DEFAULT 0,
  nequi INTEGER NOT NULL DEFAULT 0,
  bancolombia INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  posted_by INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(business_id,cash_id)
);
CREATE INDEX IF NOT EXISTS idx_finance_bank_closures_business ON finance_bank_closures(business_id,closed_at,id);
