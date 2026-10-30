-- Versión del catálogo por negocio. Permite invalidar de forma segura las
-- copias de IndexedDB después de un reinicio completo de datos.
CREATE TABLE IF NOT EXISTS catalog_epochs(
  business_id INTEGER PRIMARY KEY REFERENCES businesses(id),
  epoch INTEGER NOT NULL DEFAULT 1,
  changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT OR IGNORE INTO catalog_epochs(business_id,epoch)
SELECT id,1 FROM businesses;
