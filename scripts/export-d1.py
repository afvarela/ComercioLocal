import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = sqlite3.connect(ROOT / "data" / "comercio.sqlite3")
source.row_factory = sqlite3.Row
tables = [
    "businesses", "users", "products", "customers", "cash_sessions", "quotes",
    "purchases", "lots", "sales", "sale_lines", "payments", "cash_moves",
    "stock_moves", "receivables", "receivable_moves", "purchase_lines",
    "purchase_returns", "purchase_return_lines", "sales_returns",
    "sales_return_lines", "audit", "email_queue", "document_emails",
]

def literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, (int, float)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"

output = ["PRAGMA foreign_keys=OFF;"]
for table in tables:
    try:
        rows = source.execute(f'SELECT * FROM "{table}"').fetchall()
    except sqlite3.OperationalError:
        continue
    for row in rows:
        columns = ",".join(f'"{name}"' for name in row.keys())
        values = ",".join(literal(value) for value in row)
        output.append(f'INSERT OR REPLACE INTO "{table}"({columns}) VALUES({values});')
output.extend([
    "DELETE FROM cloud_sessions;",
    "INSERT OR IGNORE INTO cloud_revision(id,version) VALUES(1,0);",
    "PRAGMA foreign_keys=ON;",
])
(ROOT / "cloudflare" / "local-data.sql").write_text("\n".join(output) + "\n", encoding="utf-8")
print(f"Exportadas {len(output)-3} filas a cloudflare/local-data.sql")
