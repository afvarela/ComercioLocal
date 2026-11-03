-- Salidas de efectivo relacionadas con pagos por Nequi y revisión previa al cierre.
-- Es una migración aditiva: no modifica ventas, pagos, inventario ni cierres anteriores.
ALTER TABLE cash_moves ADD COLUMN kind TEXT NOT NULL DEFAULT 'Movimiento de caja';
ALTER TABLE cash_moves ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_moves_request ON cash_moves(request_id) WHERE request_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS cash_nequi_reviews(
  id INTEGER PRIMARY KEY,
  business_id INTEGER NOT NULL,
  cash_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  created TEXT NOT NULL,
  nequi_amount INTEGER NOT NULL DEFAULT 0,
  decision TEXT NOT NULL,
  adjustment_amount INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_cash_nequi_reviews_cash ON cash_nequi_reviews(cash_id,id);

-- Repara ventas fiadas antiguas que quedaron sin cuenta por cobrar en D1.
INSERT OR IGNORE INTO receivables(
  business_id,customer_id,sale_id,created,original_amount,paid_amount,returned_amount,balance,status
)
SELECT business_id,customer_id,id,created,original_debt,MAX(0,original_debt-debt),0,debt,
  CASE WHEN status='void' THEN 'Anulado' WHEN debt=0 THEN 'Pagado'
       WHEN debt<original_debt THEN 'Parcialmente pagado' ELSE 'Pendiente' END
FROM sales
WHERE customer_id IS NOT NULL AND original_debt>0;

INSERT OR IGNORE INTO receivable_moves(
  receivable_id,business_id,customer_id,sale_id,created,kind,amount,balance_after,user_id,note,request_id
)
SELECT r.id,r.business_id,r.customer_id,r.sale_id,r.created,'Saldo migrado',r.original_amount,r.balance,
       s.user_id,'Cuenta por cobrar reparada por migración','migracion-' || r.sale_id
FROM receivables r JOIN sales s ON s.id=r.sale_id
WHERE NOT EXISTS(SELECT 1 FROM receivable_moves m WHERE m.receivable_id=r.id);
