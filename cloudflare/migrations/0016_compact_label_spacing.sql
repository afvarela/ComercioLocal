-- Separación independiente entre filas y margen físico del papel.
ALTER TABLE label_settings ADD COLUMN row_gap_mm INTEGER NOT NULL DEFAULT 0;
ALTER TABLE label_settings ADD COLUMN page_margin_mm INTEGER NOT NULL DEFAULT 0;
