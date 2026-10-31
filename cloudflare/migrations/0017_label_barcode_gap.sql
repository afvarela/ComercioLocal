-- Espacio configurable entre el precio y el código de barras.
ALTER TABLE label_settings ADD COLUMN barcode_gap_mm INTEGER NOT NULL DEFAULT 2;
