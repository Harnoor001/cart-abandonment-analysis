"""
Export everything the web dashboard (web/) needs into one JSON file:
web/data/dashboard.json. Aggregates come from the SQL queries in /sql; the
driver odds ratios come from the same logistic regression as the notebook.

Run:  python src/export_web_data.py
"""

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.formula.api as smf
from statsmodels.stats.power import NormalIndPower
from statsmodels.stats.proportion import proportion_confint, proportion_effectsize

from run_sql_analysis import load_queries

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / "data" / "hungrly.db"
OUT = ROOT / "web" / "data" / "dashboard.json"


def records(df: pd.DataFrame) -> list[dict]:
    return json.loads(df.to_json(orient="records"))


def main() -> None:
    con = sqlite3.connect(DB)
    Q = load_queries()
    sql = lambda name: pd.read_sql_query(Q[name], con)

    df = pd.read_sql_query(
        "SELECT * FROM vw_session_funnel WHERE furthest_step >= 2", con
    )

    # Order Review exit by 1-euro basket bin (the small-order-fee curve)
    rev = df[df.furthest_step >= 6].copy()
    rev["exit"] = rev.furthest_step.eq(6)
    rev["bin"] = np.floor(rev.cart_subtotal).clip(5, 45).astype(int)
    curve = rev.groupby("bin").agg(n=("exit", "size"), exits=("exit", "sum")).reset_index()
    lo, hi = proportion_confint(curve.exits, curve.n, method="wilson")
    curve["rate"], curve["lo"], curve["hi"] = curve.exits / curve.n, lo, hi

    # Drivers of exit at Order Review (same spec as the notebook)
    m = rev.assign(
        exit_review=rev.exit.astype(int),
        fee_ratio_10pp=rev.fee_ratio.clip(upper=0.6) * 10,
        promo_failed=rev.promo_status.str.startswith("Failed").astype(int),
        promo_applied=rev.promo_status.eq("Applied").astype(int),
        late_night=rev.time_of_day.str.startswith("5").astype(int),
    )
    model = smf.logit(
        "exit_review ~ fee_ratio_10pp + promo_failed + promo_applied + is_plus_member + is_new_user"
        " + late_night + C(platform, Treatment('iOS App')) + C(primary_category, Treatment('Groceries'))",
        data=m,
    ).fit(disp=0)
    naive = smf.logit("exit_review ~ C(primary_category, Treatment('Groceries'))", data=m).fit(disp=0)
    labels = {
        "fee_ratio_10pp": "Fees +10 pp of basket",
        "promo_failed": "Promo code failed",
        "promo_applied": "Promo applied",
        "is_plus_member": "Plus member (free delivery)",
        "is_new_user": "New customer",
        "late_night": "Late night (23–04)",
    }
    ci = np.exp(model.conf_int())
    drivers = [
        {"driver": lab, "odds_ratio": float(np.exp(model.params[k])),
         "ci_low": float(ci.loc[k, 0]), "ci_high": float(ci.loc[k, 1]), "p_value": float(model.pvalues[k])}
        for k, lab in labels.items()
    ]
    key = "C(primary_category, Treatment('Groceries'))[T.Desserts & Coffee]"
    confounding = {
        "category": "Desserts & Coffee",
        "odds_ratio_category_only": float(np.exp(naive.params[key])),
        "odds_ratio_with_controls": float(np.exp(model.params[key])),
        "n": int(model.nobs),
        "pseudo_r2": float(model.prsquared),
    }

    # A/B test sample size for the top recommendation
    p0 = float(df.converted.mean())
    daily_carts = len(df) / 183
    power = []
    for mde in [0.01, 0.015, 0.02, 0.03]:
        n = NormalIndPower().solve_power(proportion_effectsize(p0 + mde, p0), alpha=0.05, power=0.8)
        power.append({"mde_pp": mde * 100, "carts_per_arm": int(np.ceil(n)),
                      "days": int(np.ceil(2 * n / daily_carts))})

    # only what web/app.js reads, to keep the page light
    payload = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "period": {"start": "2026-04-01", "end": "2026-09-30", "days": 183},
        "kpis": records(sql("headline_kpis"))[0],
        "funnel": records(sql("funnel_overview")),
        "exits": records(sql("exit_screen_ranking")),
        "segments": records(sql("segment_step_exit_rates")),
        "segment_summary": records(sql("segment_summary")),
        "hourly": records(sql("hourly_profile")),
        "payment": records(sql("platform_payment_failures")),
        "fee_ratio": records(sql("review_exit_by_fee_ratio")),
        "basket_curve": records(curve[["bin", "n", "rate", "lo", "hi"]]),
        "promo": records(sql("review_exit_by_promo")),
        "opportunity": records(sql("opportunity_sizing")),
        "drivers": drivers,
        "confounding": confounding,
        "ab_test": {"baseline_cvr": p0, "daily_carts": daily_carts, "power": power},
    }
    con.close()
    payload = json.loads(json.dumps(payload), parse_float=lambda s: round(float(s), 4))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
