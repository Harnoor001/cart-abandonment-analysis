"""
Load the raw CSVs into a SQLite database (data/hungrly.db) using sql/01_schema.sql.

Run:  python src/build_database.py
"""

import sqlite3
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
DB = ROOT / "data" / "hungrly.db"

TABLES = ["users", "sessions", "carts", "orders", "events", "funnel_steps"]
INDEXES = [
    "CREATE INDEX IF NOT EXISTS ix_events_session ON events(session_id, step_number)",
    "CREATE INDEX IF NOT EXISTS ix_events_name    ON events(event_name)",
    "CREATE INDEX IF NOT EXISTS ix_sessions_user  ON sessions(user_id)",
    "CREATE INDEX IF NOT EXISTS ix_orders_session ON orders(session_id)",
]


def main() -> None:
    DB.unlink(missing_ok=True)
    con = sqlite3.connect(DB)
    con.executescript((ROOT / "sql" / "01_schema.sql").read_text())

    for t in TABLES:
        df = pd.read_csv(RAW / f"{t}.csv")
        for col in df.select_dtypes("bool").columns:
            df[col] = df[col].astype(int)
        df.to_sql(t, con, if_exists="append", index=False, chunksize=50_000)
        print(f"loaded {t:<13} {len(df):>9,} rows")

    for ddl in INDEXES:
        con.execute(ddl)
    con.execute("ANALYZE")
    con.commit()

    n = con.execute("SELECT COUNT(*) FROM vw_session_funnel").fetchone()[0]
    print(f"\nvw_session_funnel  {n:,} rows  ->  {DB.relative_to(ROOT)}")
    con.close()


if __name__ == "__main__":
    main()
