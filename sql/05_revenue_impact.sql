-- =====================================================================
-- 05_revenue_impact.sql
-- Q: How much money is each leak costing, and what is a fix worth?
--
-- Method (per opportunity):
--   affected     = sessions reaching the step in the problem segment
--   excess_rate  = segment exit rate - benchmark exit rate
--   extra_orders = affected * excess_rate * downstream conversion
--                  (a user saved at step N must still complete N+1..8)
--   value        = extra_orders * avg order total of that segment
--   Scenarios: full gap closure (ceiling) and 30% closure (planning case).
--   Annualised = 6-month window * (365 / 183).
-- =====================================================================

-- name: abandoned_value_by_step
SELECT  exit_step,
        furthest_step                                         AS step_number,
        COUNT(*)                                              AS abandoned_carts,
        ROUND(SUM(abandoned_value), 0)                        AS abandoned_gmv_6m_eur,
        ROUND(SUM(abandoned_value) * 365.0 / 183, 0)          AS abandoned_gmv_annualised_eur,
        ROUND(100.0 * SUM(abandoned_value) / SUM(SUM(abandoned_value)) OVER (), 1) AS share_of_abandoned_gmv_pct
FROM    vw_session_funnel
WHERE   abandoned_cart = 1
GROUP BY exit_step, furthest_step
ORDER BY abandoned_gmv_6m_eur DESC;


-- name: opportunity_sizing
WITH v AS (SELECT * FROM vw_session_funnel),

-- 1) Fee shock at Order Review: fees >= 15% of basket vs < 10% benchmark
fee AS (
    SELECT  'Fee shock'                                     AS opportunity,
            'Order Review'                                                  AS step,
            'Fees >= 15% of basket'                                         AS problem_segment,
            'Fees < 10% of basket'                                          AS benchmark_segment,
            SUM(CASE WHEN fee_ratio >= 0.15 THEN 1 ELSE 0 END)             AS affected,
            1.0 * SUM(CASE WHEN fee_ratio >= 0.15 AND furthest_step = 6 THEN 1 ELSE 0 END)
                / SUM(CASE WHEN fee_ratio >= 0.15 THEN 1 ELSE 0 END)       AS segment_rate,
            1.0 * SUM(CASE WHEN fee_ratio <  0.10 AND furthest_step = 6 THEN 1 ELSE 0 END)
                / SUM(CASE WHEN fee_ratio <  0.10 THEN 1 ELSE 0 END)       AS benchmark_rate,
            1.0 * SUM(CASE WHEN fee_ratio >= 0.15 AND converted = 1 THEN 1 ELSE 0 END)
                / SUM(CASE WHEN fee_ratio >= 0.15 AND furthest_step >= 7 THEN 1 ELSE 0 END) AS downstream_cvr,
            AVG(CASE WHEN fee_ratio >= 0.15 THEN order_total END)          AS avg_value
    FROM v WHERE furthest_step >= 6
),

-- 2) Failed promo codes at Order Review vs carts with no promo
promo AS (
    SELECT  'Failed promo codes',
            'Order Review',
            'Promo code failed',
            'No promo entered',
            SUM(CASE WHEN promo_status LIKE 'Failed%' THEN 1 ELSE 0 END),
            1.0 * SUM(CASE WHEN promo_status LIKE 'Failed%' AND furthest_step = 6 THEN 1 ELSE 0 END)
                / SUM(CASE WHEN promo_status LIKE 'Failed%' THEN 1 ELSE 0 END),
            1.0 * SUM(CASE WHEN promo_status = 'No Promo' AND furthest_step = 6 THEN 1 ELSE 0 END)
                / SUM(CASE WHEN promo_status = 'No Promo' THEN 1 ELSE 0 END),
            1.0 * SUM(CASE WHEN promo_status LIKE 'Failed%' AND converted = 1 THEN 1 ELSE 0 END)
                / SUM(CASE WHEN promo_status LIKE 'Failed%' AND furthest_step >= 7 THEN 1 ELSE 0 END),
            AVG(CASE WHEN promo_status LIKE 'Failed%' THEN order_total END)
    FROM v WHERE furthest_step >= 6
),

-- 3) Login wall at Checkout Start: new web users vs new app users
login AS (
    SELECT  'Forced sign-up (no guest checkout)',
            'Checkout Start',
            'New users on web',
            'New users on app',
            SUM(CASE WHEN is_new_user = 1 AND platform LIKE '%Web' THEN 1 ELSE 0 END),
            1.0 * SUM(CASE WHEN is_new_user = 1 AND platform LIKE '%Web' AND furthest_step = 4 THEN 1 ELSE 0 END)
                / SUM(CASE WHEN is_new_user = 1 AND platform LIKE '%Web' THEN 1 ELSE 0 END),
            1.0 * SUM(CASE WHEN is_new_user = 1 AND platform LIKE '%App' AND furthest_step = 4 THEN 1 ELSE 0 END)
                / SUM(CASE WHEN is_new_user = 1 AND platform LIKE '%App' THEN 1 ELSE 0 END),
            1.0 * SUM(CASE WHEN is_new_user = 1 AND platform LIKE '%Web' AND converted = 1 THEN 1 ELSE 0 END)
                / SUM(CASE WHEN is_new_user = 1 AND platform LIKE '%Web' AND furthest_step >= 5 THEN 1 ELSE 0 END),
            AVG(CASE WHEN is_new_user = 1 AND platform LIKE '%Web' THEN order_total END)
    FROM v WHERE furthest_step >= 4
),

-- 4) Payment friction on mobile web vs native apps
pay AS (
    SELECT  'Mobile-web payment friction',
            'Payment',
            'Mobile Web',
            'iOS + Android App',
            SUM(CASE WHEN platform = 'Mobile Web' THEN 1 ELSE 0 END),
            1.0 * SUM(CASE WHEN platform = 'Mobile Web' AND furthest_step = 7 THEN 1 ELSE 0 END)
                / SUM(CASE WHEN platform = 'Mobile Web' THEN 1 ELSE 0 END),
            1.0 * SUM(CASE WHEN platform IN ('iOS App', 'Android App') AND furthest_step = 7 THEN 1 ELSE 0 END)
                / SUM(CASE WHEN platform IN ('iOS App', 'Android App') THEN 1 ELSE 0 END),
            1.0,                                           -- payment is the last step
            AVG(CASE WHEN platform = 'Mobile Web' THEN order_total END)
    FROM v WHERE furthest_step >= 7
),

-- 5) Long ETAs at Delivery Details: 50+ min vs < 40 min
eta AS (
    SELECT  'Long delivery ETAs',
            'Delivery Details',
            'ETA 50+ min',
            'ETA < 40 min',
            SUM(CASE WHEN delivery_eta_min >= 50 THEN 1 ELSE 0 END),
            1.0 * SUM(CASE WHEN delivery_eta_min >= 50 AND furthest_step = 5 THEN 1 ELSE 0 END)
                / SUM(CASE WHEN delivery_eta_min >= 50 THEN 1 ELSE 0 END),
            1.0 * SUM(CASE WHEN delivery_eta_min <  40 AND furthest_step = 5 THEN 1 ELSE 0 END)
                / SUM(CASE WHEN delivery_eta_min <  40 THEN 1 ELSE 0 END),
            1.0 * SUM(CASE WHEN delivery_eta_min >= 50 AND converted = 1 THEN 1 ELSE 0 END)
                / SUM(CASE WHEN delivery_eta_min >= 50 AND furthest_step >= 6 THEN 1 ELSE 0 END),
            AVG(CASE WHEN delivery_eta_min >= 50 THEN order_total END)
    FROM v WHERE furthest_step >= 5
),

opps AS (
    SELECT * FROM fee   UNION ALL SELECT * FROM promo UNION ALL
    SELECT * FROM login UNION ALL SELECT * FROM pay   UNION ALL SELECT * FROM eta
)
SELECT  opportunity,
        step,
        problem_segment,
        benchmark_segment,
        affected                                                       AS sessions_affected_6m,
        ROUND(100 * segment_rate, 1)                                   AS segment_exit_pct,
        ROUND(100 * benchmark_rate, 1)                                 AS benchmark_exit_pct,
        ROUND(100 * (segment_rate - benchmark_rate), 1)                AS excess_exit_pp,
        ROUND(segment_rate / benchmark_rate, 2)                        AS relative_risk,
        ROUND(100 * downstream_cvr, 1)                                 AS downstream_cvr_pct,
        ROUND(avg_value, 2)                                            AS avg_order_value_eur,
        ROUND(affected * (segment_rate - benchmark_rate) * downstream_cvr, 0)              AS orders_recoverable_6m_full,
        ROUND(affected * (segment_rate - benchmark_rate) * downstream_cvr * avg_value
              * 365.0 / 183, 0)                                                            AS gmv_annual_full_closure_eur,
        ROUND(0.30 * affected * (segment_rate - benchmark_rate) * downstream_cvr * avg_value
              * 365.0 / 183, 0)                                                            AS gmv_annual_30pct_closure_eur
FROM    opps
ORDER BY gmv_annual_full_closure_eur DESC;
