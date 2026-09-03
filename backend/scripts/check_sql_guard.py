"""Adversarial check on the /ai/execute-sql guard.

Run from `backend/`:
    DATABASE_URL=sqlite:///./data.db .venv/bin/python scripts/check_sql_guard.py

Covers the two halves separately: what the parser rejects outright, and what
the read-only connection refuses even when the parser is assumed bypassed.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.readonly import readonly_engine, run_select  # noqa: E402
from app.sql_guard import SqlNotAllowed, validate_select  # noqa: E402

MUST_REJECT = [
    ("stacked statement", "SELECT 1; DROP TABLE prices"),
    ("trailing semicolon + DML", "SELECT * FROM companies; DELETE FROM notes"),
    ("bare delete", "DELETE FROM notes"),
    ("update", "UPDATE prices SET close = 0"),
    ("insert", "INSERT INTO notes (text) VALUES ('x')"),
    ("drop", "DROP TABLE companies"),
    ("create", "CREATE TABLE evil (id int)"),
    ("alter", "ALTER TABLE notes ADD COLUMN x int"),
    ("pragma", "PRAGMA writable_schema = ON"),
    ("attach another db", "ATTACH DATABASE '/tmp/evil.db' AS evil"),
    ("vacuum", "VACUUM"),
    ("schema exfiltration", "SELECT sql FROM sqlite_master"),
    ("unknown table", "SELECT * FROM users"),
    ("comment-spliced DML", "SELECT 1 /* nice */; UPDATE prices SET close = 0"),
    ("cte hiding a delete", "WITH x AS (SELECT 1) DELETE FROM notes"),
    ("empty", "   "),
]

MUST_ALLOW = [
    ("plain select", "SELECT ticker, name FROM companies LIMIT 5"),
    (
        "join with aggregate",
        """SELECT c.ticker, MIN(p.close) AS low
           FROM prices p JOIN companies c ON c.id = p.company_id
           GROUP BY c.ticker ORDER BY low ASC LIMIT 5""",
    ),
    (
        "cte",
        """WITH recent AS (SELECT * FROM prices WHERE date >= '2025-01-01')
           SELECT company_id, AVG(close) FROM recent GROUP BY company_id""",
    ),
    ("union", "SELECT ticker FROM companies UNION SELECT text FROM notes"),
    ("subquery ticker resolution",
     "SELECT date, close FROM prices WHERE company_id = (SELECT id FROM companies WHERE ticker = 'AAPL')"),
    ("time literal with colon", "SELECT * FROM notes WHERE created_at > '2025-01-01 09:30:00'"),
]

failures = 0

print("== parser: must reject ==")
for label, sql in MUST_REJECT:
    try:
        validate_select(sql)
        print(f"  FAIL  {label}: ALLOWED -> {sql!r}")
        failures += 1
    except SqlNotAllowed as exc:
        print(f"  ok    {label}: {exc}")

print("\n== parser: must allow ==")
for label, sql in MUST_ALLOW:
    try:
        validate_select(sql)
        print(f"  ok    {label}")
    except SqlNotAllowed as exc:
        print(f"  FAIL  {label}: REJECTED -> {exc}")
        failures += 1

print("\n== read-only connection (parser assumed bypassed) ==")
for label, sql in [
    ("delete", "DELETE FROM notes"),
    ("update", "UPDATE prices SET close = 0"),
    ("create", "CREATE TABLE evil (id int)"),
]:
    try:
        with readonly_engine.connect() as connection:
            connection.exec_driver_sql(sql)
            connection.commit()
        print(f"  FAIL  {label}: the write SUCCEEDED")
        failures += 1
    except Exception as exc:  # noqa: BLE001 - any refusal is a pass
        print(f"  ok    {label}: {type(exc).__name__}: {str(exc).splitlines()[0][:90]}")

print("\n== execution ==")
columns, rows, truncated = run_select("SELECT ticker, name FROM companies ORDER BY ticker LIMIT 3")
print(f"  columns={columns} truncated={truncated}")
for row in rows:
    print(f"  {row}")
if not rows:
    print("  (no rows - is data.db seeded?)")

columns, rows, truncated = run_select("SELECT id FROM prices")
print(f"  row cap: got {len(rows)} rows, truncated={truncated}")

print("\n== timeout ==")
import time  # noqa: E402

start = time.monotonic()
try:
    run_select("SELECT COUNT(*) FROM prices a, prices b, prices c")
    print(f"  FAIL  completed in {time.monotonic() - start:.1f}s without interrupting")
    failures += 1
except Exception as exc:  # noqa: BLE001
    print(f"  ok    interrupted after {time.monotonic() - start:.1f}s: {str(exc).splitlines()[0][:60]}")

print(f"\n{'FAILURES: ' + str(failures) if failures else 'all checks passed'}")
sys.exit(1 if failures else 0)
