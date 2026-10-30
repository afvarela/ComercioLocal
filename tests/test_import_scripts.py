import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class ImportScriptsTest(unittest.TestCase):
    def test_cloud_import_exports_only_real_tables(self):
        script = (ROOT / "scripts" / "import-inventory-cloud.ps1").read_text(
            encoding="utf-8"
        )
        self.assertIn("$BackupTables", script)
        self.assertIn("--table", script)
        self.assertIn("--no-schema", script)
        self.assertIn("--skip-confirmation", script)
        self.assertIn("sqlite_schema", script)
        self.assertIn("$DeclaredTables", script)
        self.assertIn("$RemoteTables", script)
        self.assertNotRegex(
            script,
            re.compile(
                r"d1\s+export\s+comercio-local\s+--remote\s+--output",
                re.IGNORECASE,
            ),
        )
        self.assertIn("product_search", script)


if __name__ == "__main__":
    unittest.main()
