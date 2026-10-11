"""
Export a Power BI-ready star schema from data/hungrly.db to data/powerbi/.

    fact_sessions      one row per session (grain for every KPI)
    fact_step_reach    one row per (session, funnel step reached) -> funnel visual
    dim_step           8 funnel steps with sort order
    dim_date           calendar table (mark as date table in Power BI)
    opportunity_sizing output of sql/05_revenue_impact.sql (for the "Fix it" page)

Run:  python src/export_powerbi.py
"""

import sqlite3
from pathlib import Path

import pandas as pd

from run_sql_analysis import load_queries

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "hungrly.db"
OUT = ROOT / "data" / "powerbi"


def fee_band(r: float) -> str:
    if pd.isna(r):
        return None
    for limit, label in [(0.05, "01. <5%"), (0.10, "02. 5-10%"), (0.15, "03. 10-15%"), (0.20, "04. 15-20%"),
                         (0.30, "05. 20-30%"), (0.40, "06. 30-40%")]:
        if r < limit:
            return label
    return "07. 40%+"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB)

    fact = pd.read_sql_query("SELECT * FROM vw_session_funnel", con)
    fact["customer_type"] = fact.pop("is_new_user").map({1: "New", 0: "Returning"})
    fact["is_plus_member"] = fact["is_plus_member"].map({1: "Plus", 0: "Standard"})
    fact["channel"] = fact["platform"].str.endswith("App").map({True: "App", False: "Web"})
    fact["fee_ratio_band"] = fact["fee_ratio"].map(fee_band)
    fact["basket_band"] = pd.cut(
        fact["cart_subtotal"], [0, 10, 15, 20, 30, 50, 10_000], right=False,
        labels=["01. <€10", "02. €10-15", "03. €15-20", "04. €20-30", "05. €30-50", "06. €50+"],
    ).astype("string")
    fact["promo_outcome"] = fact["promo_status"].str.replace(r" - .*", "", regex=True)
    fact["has_small_order_fee"] = (fact["small_order_fee"] > 0).map({True: "Yes", False: "No"})
    fact.loc[fact["cart_subtotal"].isna(), "has_small_order_fee"] = None
    fact.to_csv(OUT / "fact_sessions.csv", index=False)

    reach = pd.read_sql_query("""
        SELECT e.session_id, e.step_number
        FROM events e JOIN funnel_steps f ON f.event_name = e.event_name
    """, con)
    reach.to_csv(OUT / "fact_step_reach.csv", index=False)

    steps = pd.read_sql_query("SELECT step_number, step_label, event_name FROM funnel_steps", con)
    steps["is_checkout_step"] = steps["step_number"] >= 2
    steps.to_csv(OUT / "dim_step.csv", index=False)

    dates = pd.DataFrame({"date": pd.date_range("2026-04-01", "2026-09-30", freq="D")})
    dates["year"] = dates.date.dt.year
    dates["month_num"] = dates.date.dt.month
    dates["month"] = dates.date.dt.strftime("%b %Y")
    dates["week_start"] = (dates.date - pd.to_timedelta(dates.date.dt.dayofweek, unit="D")).dt.date
    dates["day_of_week"] = dates.date.dt.strftime("%a")
    dates["day_of_week_num"] = dates.date.dt.dayofweek + 1
    dates["is_weekend"] = dates.date.dt.dayofweek >= 5
    dates["date"] = dates.date.dt.date
    dates.to_csv(OUT / "dim_date.csv", index=False)

    opp = pd.read_sql_query(load_queries()["opportunity_sizing"], con)
    opp.to_csv(OUT / "opportunity_sizing.csv", index=False)
    con.close()

    for p in sorted(OUT.glob("*.csv")):
        print(f"{p.name:<26} {sum(1 for _ in open(p, encoding='utf-8')) - 1:>9,} rows")


if __name__ == "__main__":
    main()
