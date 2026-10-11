"""
Execute every named query in sql/02-05*.sql against data/hungrly.db and export
each result to outputs/sql_results/<name>.csv.

A query block starts with a line "-- name: <query_name>".

Run:  python src/run_sql_analysis.py            (all queries)
      python src/run_sql_analysis.py funnel     (only names containing "funnel")
"""

import re
import sqlite3
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "hungrly.db"
SQL_DIR = ROOT / "sql"
OUT = ROOT / "outputs" / "sql_results"

NAME_RE = re.compile(r"^--\s*name:\s*(\w+)\s*$", re.MULTILINE)


def load_queries() -> dict[str, str]:
    """Return {query_name: sql} for every named block in sql/0[2-9]*.sql."""
    queries = {}
    for path in sorted(SQL_DIR.glob("0[2-9]_*.sql")):
        text = path.read_text()
        marks = list(NAME_RE.finditer(text))
        for i, m in enumerate(marks):
            end = marks[i + 1].start() if i + 1 < len(marks) else len(text)
            queries[m.group(1)] = text[m.end():end].strip().rstrip(";")
    return queries


def main() -> None:
    pattern = sys.argv[1] if len(sys.argv) > 1 else ""
    OUT.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB)
    pd.set_option("display.width", 200, "display.max_columns", 20)
    for name, sql in load_queries().items():
        if pattern not in name:
            continue
        df = pd.read_sql_query(sql, con)
        df.to_csv(OUT / f"{name}.csv", index=False)
        print(f"\n=== {name}  ({len(df)} rows) ===")
        print(df.head(15).to_string(index=False))
    con.close()


if __name__ == "__main__":
    main()
