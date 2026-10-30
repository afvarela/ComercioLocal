-- Búsqueda parcial indexada. FTS5 trigram evita recorrer los 1.500 productos
-- para consultas de tres o más caracteres y conserva los datos originales.
CREATE VIRTUAL TABLE IF NOT EXISTS product_search USING fts5(
  business_id UNINDEXED,
  product_id UNINDEXED,
  searchable,
  tokenize='trigram remove_diacritics 1'
);

INSERT INTO product_search(rowid,business_id,product_id,searchable)
SELECT p.id,p.business_id,p.id,
  trim(COALESCE(p.name,'') || ' ' || COALESCE(p.sku,'') || ' ' ||
       COALESCE(p.barcode,'') || ' ' || COALESCE(p.description,'') || ' ' ||
       COALESCE(p.category,''))
FROM products p
WHERE NOT EXISTS(SELECT 1 FROM product_search s WHERE s.rowid=p.id);

CREATE TRIGGER IF NOT EXISTS product_search_insert AFTER INSERT ON products BEGIN
  INSERT INTO product_search(rowid,business_id,product_id,searchable)
  VALUES(NEW.id,NEW.business_id,NEW.id,
    trim(COALESCE(NEW.name,'') || ' ' || COALESCE(NEW.sku,'') || ' ' ||
         COALESCE(NEW.barcode,'') || ' ' || COALESCE(NEW.description,'') || ' ' ||
         COALESCE(NEW.category,'')));
END;

CREATE TRIGGER IF NOT EXISTS product_search_update
AFTER UPDATE OF business_id,sku,barcode,name,description,category,active ON products BEGIN
  DELETE FROM product_search WHERE rowid=OLD.id;
  INSERT INTO product_search(rowid,business_id,product_id,searchable)
  SELECT NEW.id,NEW.business_id,NEW.id,
    trim(COALESCE(NEW.name,'') || ' ' || COALESCE(NEW.sku,'') || ' ' ||
         COALESCE(NEW.barcode,'') || ' ' || COALESCE(NEW.description,'') || ' ' ||
         COALESCE(NEW.category,''))
  WHERE NEW.active=1;
END;

CREATE TRIGGER IF NOT EXISTS product_search_delete AFTER DELETE ON products BEGIN
  DELETE FROM product_search WHERE rowid=OLD.id;
END;
