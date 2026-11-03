ALTER TABLE customers ADD COLUMN request_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_offline_request
ON customers(business_id,request_id)
WHERE request_id IS NOT NULL;
