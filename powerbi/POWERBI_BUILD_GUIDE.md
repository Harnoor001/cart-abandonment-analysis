# Power BI Build Guide: Hungrly Checkout Funnel Dashboard

A 4-page report that answers *"where are customers dropping off, and what should we fix?"* in the order an exec reads it:
**What's happening → Who it affects → Why → What it's worth to fix.**

Time to build: ~2–3 hours. Everything you need is in this folder plus `data/powerbi/`.

> **Already done for you:** sections 1–2 (tables, types, relationships, date table, sort orders), all 34 measures, the
> `Segment By` field parameter and the `Gap Closure` what-if table are built in the model. Apply the theme
> (View → Themes → Browse → `hungrly_theme.json`) and start at **section 3**. For the what-if slider, add a slicer on
> `'Gap Closure'[Gap Closure]` (single value). If the project folder moves, update the `DataFolder` parameter
> (Transform data → Manage parameters) and refresh.

---

## 1. Load the data (Get Data → Text/CSV)

| File (`data/powerbi/`) | Rows | Role |
|---|---|---|
| `fact_sessions.csv` | 185,000 | Fact table, one row per session (grain for every KPI) |
| `fact_step_reach.csv` | 804,361 | Bridge, one row per session × funnel step reached |
| `dim_step.csv` | 8 | Funnel step dimension |
| `dim_date.csv` | 183 | Calendar → *Table tools → Mark as date table* (`date`) |
| `opportunity_sizing.csv` | 5 | Output of `sql/05_revenue_impact.sql` |

**Power Query type fixes:** `session_date` and `dim_date[date]` → Date; `session_start` → Date/Time; `fee_ratio` → Decimal;
money columns → Fixed decimal. Set **Sort by column**: `dim_step[step_label]` by `step_number`, `dim_date[month]` by `month_num`,
`dim_date[day_of_week]` by `day_of_week_num`.

## 2. Model (Model view)

```
dim_date[date]             1 ──► *  fact_sessions[session_date]
fact_sessions[session_id]  1 ──► *  fact_step_reach[session_id]
dim_step[step_number]      1 ──► *  fact_step_reach[step_number]
opportunity_sizing                 (disconnected, used only on the Fix-It page)
```
All relationships single-direction. Hide the key columns on the many side.

Then: **View → Themes → Browse for themes →** `hungrly_theme.json`, and paste the measures from **`measures.dax`**.

## 3. Pages

### Page 1: Executive Overview
| Visual | Fields | Notes |
|---|---|---|
| Text box / card | `[Biggest Leak Headline]` | Dynamic, updates with every slicer |
| 6 KPI cards | Sessions · Carts · Orders · Cart Abandonment % · GMV · Abandoned Basket Value (Annualised) | Callout 28pt |
| **Funnel** | Category `dim_step[step_label]`, Values `[Users Reached Step]` | Tooltips: Step Conversion %, Users Lost Before Step |
| Clustered bar | Axis `step_label` (filter: step 2–7), Value `[Exit Rate at Step]` | *Bars → Color → fx → Field value →* `[Exit Bar Colour]` so the worst screen auto-highlights orange |
| Clustered bar | Axis `step_label`, Value `[Abandoned Value at Step (Annualised)]` | Same colour rule |
| Line | `dim_date[week_start]` × `[Cart Abandonment %]` and a second line chart for `[Order Review Exit %]` | Shows the problem is structural, not a one-off |
| Slicers (top row) | `dim_date[date]` (between), `platform`, `primary_category`, `customer_type` | Sync slicers across pages |

### Page 2: Segment Explorer (mobile vs laptop, category, time of day)
| Visual | Fields | Notes |
|---|---|---|
| **Matrix heatmap** | Rows `Segment By` (field parameter), Columns `dim_step[step_label]` (steps 2–7), Values `[Exit Rate at Step]` | *Cell elements → Background colour → Gradient* `#F2F7FD → #0D366B`. One visual answers device, category, time and customer type |
| Slicer (buttons) | `Segment By[Segment By]` | Single-select, horizontal |
| Bar | `fact_sessions[platform]` × `[Cart Abandonment %]` | Add `[Cart Abandonment Index]` to tooltip |
| Line + column (two visuals, stacked) | `session_hour` × `[Carts]` (top) and `session_hour` × `[Cart Abandonment %]` (bottom) | Never put both on one dual-axis chart |
| Table | `platform`, `payment_method`, `[Payment Error Rate]`, `[Payment Exit %]` | Data bars on Payment Exit % |

### Page 3: Root Cause at Order Review
| Visual | Fields | Notes |
|---|---|---|
| KPI card | `[Order Review Exit %]` | |
| Column | `fee_ratio_band` × `[Order Review Exit %]` | The fee-shock curve: 11% → 69% |
| Column | `basket_band` × `[Order Review Exit %]`, legend `has_small_order_fee` | The €15 small-order-fee cliff |
| Bar | `promo_status` × `[Order Review Exit %]` | Failed promos 50–72% vs 26% |
| **Decomposition tree** | Analyze `[Abandoned Value at Step]` (page filter `dim_step[step_number] = 6`), Explain by `promo_outcome`, `basket_band`, `fee_ratio_band`, `platform`, `primary_category` | Use *High value* AI splits in the demo |
| **Key influencers** | Analyze `exit_step` = "Order Review" (filter `furthest_step >= 6`), Explain by `fee_ratio`, `promo_status`, `is_plus_member`, `customer_type`, `primary_category`, `time_of_day` | Mirrors the notebook's logistic regression |

### Page 4: Fix It (Opportunity & Recommendations)
| Visual | Fields | Notes |
|---|---|---|
| What-if slider | `Gap Closure` (0–100%, default 30%) | Modeling → New parameter → Numeric range |
| Card | `[Recoverable GMV Label]` | |
| Bar | `opportunity_sizing[opportunity]` × `[Recoverable GMV (Annual)]` | Sorted desc |
| Table | opportunity, step, segment_exit_pct, benchmark_exit_pct, relative_risk, sessions_affected_6m | Conditional icons on relative_risk |
| Text box | The 5 recommendations from the README | Keep it to one line each |

## 4. Check your numbers

With no filters applied the report must show:

| Measure | Expected |
|---|---|
| Sessions / Carts / Orders | 185,000 / 126,378 / 52,774 |
| Cart Abandonment % | 58.2% |
| GMV / AOV | €1.86M / €35.21 |
| Exit Rate at Step: Order Review | 28.3% (the highlighted bar) |
| Abandoned Value at Step (Annualised): Order Review | ≈ €1.20M |
| Order Review Exit %, fees 40%+ band | 69.4% |
| Payment Exit %, Mobile Web | 18.2% |
| Recoverable GMV (Annual) @ 30% | ≈ €261K |

If a number is off, check the relationship direction and that `dim_step[step_label]` is sorted by `step_number`.

## 5. Publish

Save as `data/powerbi/Hungrly_Checkout_Funnel.pbix`, export **File → Export → PDF** to `reports/`, and take a screenshot of each page
for `reports/figures/powerbi_page_<n>.png` so the GitHub README can show it.
