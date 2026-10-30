-- Exclude technical Excel traceability from commercial product searches.
-- Product, inventory and sales data are not modified; only the derived FTS
-- index is rebuilt once.
CREATE TABLE IF NOT EXISTS app_migrations(
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DROP TRIGGER IF EXISTS product_search_insert;
DROP TRIGGER IF EXISTS product_search_update;

DELETE FROM product_search
WHERE NOT EXISTS(
  SELECT 1 FROM app_migrations WHERE name='0013_clean_product_search'
);

INSERT INTO product_search(rowid,business_id,product_id,searchable)
SELECT p.id,p.business_id,p.id,
  trim(COALESCE(p.name,'') || ' ' || COALESCE(p.sku,'') || ' ' ||
       COALESCE(p.barcode,'') || ' ' ||
       CASE WHEN lower(trim(COALESCE(p.description,''))) LIKE 'importado desde excel,%'
            THEN '' ELSE COALESCE(p.description,'') END || ' ' ||
       COALESCE(p.category,''))
FROM products p
WHERE p.active=1
  AND NOT EXISTS(
    SELECT 1 FROM app_migrations WHERE name='0013_clean_product_search'
  );

CREATE TRIGGER product_search_insert AFTER INSERT ON products
WHEN NEW.active=1 BEGIN
  INSERT INTO product_search(rowid,business_id,product_id,searchable)
  VALUES(NEW.id,NEW.business_id,NEW.id,
    trim(COALESCE(NEW.name,'') || ' ' || COALESCE(NEW.sku,'') || ' ' ||
         COALESCE(NEW.barcode,'') || ' ' ||
         CASE WHEN lower(trim(COALESCE(NEW.description,''))) LIKE 'importado desde excel,%'
              THEN '' ELSE COALESCE(NEW.description,'') END || ' ' ||
         COALESCE(NEW.category,'')));
END;

CREATE TRIGGER product_search_update
AFTER UPDATE OF business_id,sku,barcode,name,description,category,active ON products BEGIN
  DELETE FROM product_search WHERE rowid=OLD.id;
  INSERT INTO product_search(rowid,business_id,product_id,searchable)
  SELECT NEW.id,NEW.business_id,NEW.id,
    trim(COALESCE(NEW.name,'') || ' ' || COALESCE(NEW.sku,'') || ' ' ||
         COALESCE(NEW.barcode,'') || ' ' ||
         CASE WHEN lower(trim(COALESCE(NEW.description,''))) LIKE 'importado desde excel,%'
              THEN '' ELSE COALESCE(NEW.description,'') END || ' ' ||
         COALESCE(NEW.category,''))
  WHERE NEW.active=1;
END;

INSERT OR IGNORE INTO app_migrations(name)
VALUES('0013_clean_product_search');
