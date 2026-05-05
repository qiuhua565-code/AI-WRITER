"""One-off: add purpose column via psycopg2 (sync driver, avoids Python 3.14 asyncio issue)."""
import psycopg2

conn = psycopg2.connect(
    host="47.100.234.21",
    port=5432,
    dbname="aistoryflow",
    user="postgres",
    password="ww120120.",
)
conn.autocommit = True
cur = conn.cursor()

# Check if column exists
cur.execute(
    "SELECT COUNT(*) FROM information_schema.columns "
    "WHERE table_name='system_api_keys' AND column_name='purpose'"
)
exists = cur.fetchone()[0]

if exists:
    print("Column 'purpose' already exists, nothing to do.")
else:
    cur.execute(
        "ALTER TABLE system_api_keys "
        "ADD COLUMN purpose TEXT NOT NULL DEFAULT 'both'"
    )
    print("Column 'purpose' added successfully.")

# Stamp alembic version
cur.execute("SELECT version_num FROM alembic_version")
ver = cur.fetchone()
print(f"Current alembic version: {ver}")
if ver and ver[0] == "f7g8h9i0":
    cur.execute(
        "UPDATE alembic_version SET version_num = 'g8h9i0j1' "
        "WHERE version_num = 'f7g8h9i0'"
    )
    print("Alembic version stamped to g8h9i0j1.")
elif ver and ver[0] == "g8h9i0j1":
    print("Alembic already at g8h9i0j1.")

cur.close()
conn.close()
