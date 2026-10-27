ALTER TABLE finance_permissions ADD COLUMN can_create INTEGER NOT NULL DEFAULT 0;
ALTER TABLE finance_permissions ADD COLUMN can_export INTEGER NOT NULL DEFAULT 0;
UPDATE finance_permissions SET can_create=can_write,can_export=can_report;
CREATE TABLE IF NOT EXISTS finance_profit_funding(id INTEGER PRIMARY KEY,business_id INTEGER NOT NULL,profit_id INTEGER NOT NULL,account_id INTEGER NOT NULL,amount INTEGER NOT NULL,movement_id INTEGER NOT NULL,UNIQUE(profit_id,account_id));
UPDATE finance_accounts SET active=0 WHERE type='petty_cash';
