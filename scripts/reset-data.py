import argparse
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATABASE = ROOT / "data" / "comercio.sqlite3"
PRESERVED_TABLES = {"businesses", "cloud_revision", "d1_migrations", "_cf_KV"}


def main():
    parser = argparse.ArgumentParser(description="Borra los datos de prueba de ComercioLocal")
    parser.add_argument("--database", type=Path, default=DEFAULT_DATABASE)
    parser.add_argument("--confirm", default="")
    args = parser.parse_args()
    database = args.database.resolve()
    if args.confirm != "BORRAR":
        raise SystemExit("Operacion cancelada. Use --confirm BORRAR para autorizar el reinicio.")
    if not database.exists():
        raise SystemExit(f"No existe la base local: {database}")

    backups = database.parent / "backups"
    backups.mkdir(parents=True, exist_ok=True)
    backup = backups / f"antes-borrado-{datetime.now():%Y%m%d-%H%M%S}.sqlite3"

    with sqlite3.connect(database) as source, sqlite3.connect(backup) as target:
        source.backup(target)

    with sqlite3.connect(database) as connection:
        connection.execute("PRAGMA foreign_keys=OFF")
        tables = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
            if row[0] not in PRESERVED_TABLES
        ]
        connection.execute("BEGIN")
        for table in tables:
            escaped = table.replace('"', '""')
            connection.execute(f'DELETE FROM "{escaped}"')
        if connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='sqlite_sequence'"
        ).fetchone():
            connection.execute("DELETE FROM sqlite_sequence")
        connection.commit()
        connection.execute("PRAGMA foreign_keys=ON")

    # Ejecuta el esquema vigente para restaurar solo catalogos predeterminados.
    sys.path.insert(0, str(ROOT))
    from server import Store
    Store(database)

    print(f"Respaldo creado: {backup}")
    print("Base local reiniciada. Abra la aplicacion para crear el administrador con un PIN nuevo.")


if __name__ == "__main__":
    main()
