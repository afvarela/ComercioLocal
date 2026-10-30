import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ResetScriptsTest(unittest.TestCase):
    def test_cloud_reset_clears_data_and_restores_system_catalogs(self):
        database = sqlite3.connect(":memory:")
        for migration in sorted((ROOT / "cloudflare" / "migrations").glob("*.sql")):
            database.executescript(migration.read_text(encoding="utf-8"))

        reset_sql = (ROOT / "cloudflare" / "reset-test-data.sql").read_text(encoding="utf-8")
        incompatible = ("BEGIN TRANSACTION", "SAVEPOINT", "PRAGMA foreign_keys")
        for statement in incompatible:
            self.assertNotIn(statement, reset_sql)
        database.executescript(reset_sql)
        database.executescript(
            (ROOT / "cloudflare" / "migrations" / "0005_vegetable_catalog.sql").read_text(
                encoding="utf-8"
            )
        )

        expected = {
            "users": 0,
            "sales": 0,
            "customers": 0,
            "lots": 0,
            "products": 21,
            "finance_accounts": 8,
            "dairy_products": 2,
            "label_settings": 2,
            "unregistered_options": 6,
            "businesses": 2,
        }
        actual = {
            table: database.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in expected
        }
        self.assertEqual(actual, expected)
        epochs = database.execute(
            "SELECT business_id,epoch FROM catalog_epochs ORDER BY business_id"
        ).fetchall()
        self.assertEqual(epochs, [(1, 2), (2, 2)])
        self.assertEqual(
            database.execute("SELECT COUNT(*) FROM catalog_changes").fetchone()[0],
            42,
        )

    def test_cloud_reset_script_does_not_export_or_create_backups(self):
        script = (ROOT / "scripts" / "reset-cloud-data.ps1").read_text(encoding="utf-8")
        launcher = (ROOT / "BORRAR-DATOS-PRUEBA-CLOUD.cmd").read_text(encoding="utf-8")
        self.assertNotIn("d1 export", script.lower())
        self.assertNotIn("BackupFolder", script)
        self.assertIn("sin respaldo", script.lower())
        self.assertIn("NO se creara respaldo", launcher)
        manual = (ROOT / "cloudflare" / "BORRAR-DATOS-PRUEBA-MANUAL-D1.sql").read_text(
            encoding="utf-8"
        )
        self.assertIn("UPDATE catalog_epochs", manual)
        self.assertIn("DELETE FROM catalog_changes", manual)


if __name__ == "__main__":
    unittest.main()
