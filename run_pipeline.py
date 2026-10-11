"""
Reproduce the entire project end-to-end (~2 minutes):

    1. generate synthetic clickstream          -> data/raw/
    2. load into SQLite                        -> data/hungrly.db
    3. run every SQL analysis query            -> outputs/sql_results/
    4. export Power BI star schema             -> data/powerbi/
    5. export the web dashboard's data         -> web/data/dashboard.json
    6. execute the analysis notebook           -> notebooks/ + reports/figures/

Run:  python run_pipeline.py
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STEPS = [
    ["src/generate_data.py"],
    ["src/build_database.py"],
    ["src/run_sql_analysis.py"],
    ["src/export_powerbi.py"],
    ["src/export_web_data.py"],
    ["-m", "jupyter", "nbconvert", "--to", "notebook", "--execute", "--inplace",
     "notebooks/cart_abandonment_analysis.ipynb", "--ExecutePreprocessor.timeout=900"],
]

for step in STEPS:
    print(f"\n>>> python {' '.join(step)}")
    subprocess.run([sys.executable, *step], cwd=ROOT, check=True,
                   stdout=subprocess.DEVNULL if "run_sql_analysis" in step[0] else None)
print("\nDone. Open notebooks/cart_abandonment_analysis.ipynb or reports/figures/.")
