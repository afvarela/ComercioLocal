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
            "businesses": 2,
        }
        actual = {
            table: database.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for table in expected
        }
        self.assertEqual(actual, expected)


if __name__ == "__main__":
    unittest.main()
