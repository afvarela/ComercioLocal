from __future__ import annotations
import argparse, json, shutil, sqlite3, tempfile, time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "comercio.sqlite3"
MIGRATION = ROOT / "cloudflare" / "migrations" / "0011_d1_read_optimization.sql"
OLD = """SELECT p.*,COALESCE((SELECT SUM(qty) FROM lots WHERE product_id=p.id),0) stock,COALESCE((SELECT SUM(qty) FROM lots WHERE product_id=p.id AND (expires IS NULL OR expires>=?)),0) available FROM products p WHERE p.business_id=? AND p.active=1 ORDER BY p.name"""
FULL = """SELECT p.*,COALESCE(SUM(l.qty),0) stock,COALESCE(SUM(CASE WHEN l.expires IS NULL OR l.expires>=? THEN l.qty ELSE 0 END),0) available FROM products p LEFT JOIN lots l ON l.product_id=p.id AND l.business_id=p.business_id WHERE p.business_id=? AND p.active=1 GROUP BY p.id ORDER BY p.name"""
PAGE = """WITH page AS (SELECT * FROM products WHERE business_id=? AND active=1 AND id>? ORDER BY id LIMIT ?) SELECT p.*,COALESCE(SUM(l.qty),0) stock,COALESCE(SUM(CASE WHEN l.expires IS NULL OR l.expires>=? THEN l.qty ELSE 0 END),0) available FROM page p LEFT JOIN lots l ON l.product_id=p.id AND l.business_id=p.business_id GROUP BY p.id ORDER BY p.id"""

def plan(db, sql, args):
    return [row[3] for row in db.execute("EXPLAIN QUERY PLAN " + sql, args)]

def timed(db, sql, args, repeats=10):
    started=time.perf_counter()
    count=0
    for _ in range(repeats): count=len(db.execute(sql,args).fetchall())
    return {"rows_returned":count,"average_ms":round((time.perf_counter()-started)*1000/repeats,3)}

def main():
    parser=argparse.ArgumentParser(description="Audita consultas D1 sobre una copia temporal; nunca modifica la base indicada.")
    parser.add_argument("--database",type=Path,default=DEFAULT_DB)
    args=parser.parse_args(); source=args.database.resolve()
    if not source.exists(): raise SystemExit(f"No existe la base local: {source}")
    audit_root=ROOT / "tmp"; audit_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="comercio-d1-audit-",dir=audit_root) as folder:
        copy=Path(folder)/"audit.sqlite3"; shutil.copy2(source,copy)
        db=sqlite3.connect(copy)
        db.executescript(MIGRATION.read_text("utf-8"))
        today="2026-10-28"; business=1
        counts={table:db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] for table in ("products","lots","sales","sale_lines","payments","catalog_changes")}
        result={
          "source_read_only":str(source),"temporary_copy":str(copy),"counts":counts,
          "observed_production_before":{"route":"/api/state","rows_read":353331,"products_returned":1419},
          "old_correlated":{"plan":plan(db,OLD,(today,business)),**timed(db,OLD,(today,business))},
          "optimized_full_compatibility":{"plan":plan(db,FULL,(today,business)),**timed(db,FULL,(today,business))},
          "optimized_page_30":{"plan":plan(db,PAGE,(business,0,30,today)),**timed(db,PAGE,(business,0,30,today))},
          "incremental_cursor_plan":plan(db,"SELECT id,product_id FROM catalog_changes WHERE business_id=? AND id>? ORDER BY id LIMIT ?",(business,0,100)),
          "lookup_plans":{
            "sku":plan(db,"SELECT id FROM products WHERE business_id=? AND sku=?",(business,"SKU")),
            "barcode":plan(db,"SELECT id FROM products WHERE business_id=? AND barcode=?",(business,"7700000000000")),
            "category":plan(db,"SELECT id,name FROM products WHERE business_id=? AND active=1 AND category=? ORDER BY name LIMIT 30",(business,"Aseo")),
            "name_prefix":plan(db,"SELECT id,name FROM products WHERE business_id=? AND active=1 AND name COLLATE NOCASE>=? AND name COLLATE NOCASE<? ORDER BY name COLLATE NOCASE LIMIT 30",(business,"sha","shb")),
          },
        }
        print(json.dumps(result,ensure_ascii=False,indent=2)); db.close()

if __name__ == "__main__": main()
