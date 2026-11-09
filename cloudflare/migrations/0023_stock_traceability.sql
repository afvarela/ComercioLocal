-- Trazabilidad física de inventario e idempotencia por operación.
ALTER TABLE stock_moves ADD COLUMN balance_before INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stock_moves ADD COLUMN request_id TEXT;
-- Reconstruye el saldo histórico partiendo de la existencia actual y recorriendo
-- hacia atrás los movimientos posteriores del mismo producto.
UPDATE stock_moves AS movement
SET balance_after=(
  SELECT COALESCE(SUM(lot.qty),0)
  FROM lots lot
  WHERE lot.business_id=movement.business_id AND lot.product_id=movement.product_id
)-COALESCE((
  SELECT SUM(later.qty)
  FROM stock_moves later
  WHERE later.business_id=movement.business_id
    AND later.product_id=movement.product_id
    AND (later.created>movement.created OR (later.created=movement.created AND later.id>movement.id))
),0);
UPDATE stock_moves SET balance_before=balance_after-qty;
CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_moves_request ON stock_moves(business_id,request_id) WHERE request_id IS NOT NULL AND request_id!='';
