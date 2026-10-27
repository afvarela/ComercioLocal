#!/usr/bin/env python3
"""Archiva los accesos locales y conserva intactos los datos del negocio."""

from datetime import datetime
from pathlib import Path
import shutil
import sqlite3

ROOT = Path(__file__).resolve().parents[1]
DATABASE = ROOT / "data" / "comercio.sqlite3"
BACKUPS = ROOT / "backups"


def main():
    if not DATABASE.exists():
        raise SystemExit(f"No existe la base de datos local: {DATABASE}")
    BACKUPS.mkdir(exist_ok=True)
    backup = BACKUPS / f"antes-reset-usuario-{datetime.now():%Y%m%d-%H%M%S}.sqlite3"
    shutil.copy2(DATABASE, backup)
    with sqlite3.connect(DATABASE) as db:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("BEGIN IMMEDIATE")
        active = db.execute("SELECT COUNT(*) FROM users WHERE active=1").fetchone()[0]
        db.execute("DELETE FROM sessions")
        db.execute("DELETE FROM finance_permissions")
        db.execute("""UPDATE users
                      SET username='archivado-' || id || '-' || username, active=0
                      WHERE active=1""")
        db.commit()
    print(f"Usuarios activos archivados: {active}")
    print(f"Copia de seguridad: {backup}")
    print("Acceso local reiniciado. Cree el nuevo administrador con un PIN de 4 numeros.")


if __name__ == "__main__":
    main()
