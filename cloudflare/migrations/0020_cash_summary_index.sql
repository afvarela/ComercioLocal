-- Evita recorrer todas las ventas cada vez que se actualiza el resumen de la caja abierta.
-- Es una migración aditiva: no modifica ni elimina ventas, pagos o inventario.
CREATE INDEX IF NOT EXISTS idx_sales_cash_status ON sales(cash_id,status);
