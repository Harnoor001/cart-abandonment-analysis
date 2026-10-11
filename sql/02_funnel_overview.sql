-- =====================================================================
-- 02_funnel_overview.sql
-- Q: Where in the checkout flow are customers dropping off the most?
-- Each "-- name:" block is one query; src/run_sql_analysis.py exports
-- every block to outputs/sql_results/<name>.csv
-- =====================================================================

-- name: funnel_overview
-- Sessions reaching each step, step-to-step conversion and drop-off.
WITH step_reach AS (
    SELECT  fs.step_number,
            fs.step_label,
            COUNT(DISTINCT e.session_id) AS sessions_reached
    FROM    funnel_steps fs
    LEFT JOIN events e ON e.event_name = fs.event_name
    GROUP BY fs.step_number, fs.step_label
)
SELECT  step_number,
        step_label,
        sessions_reached,
        LAG(sessions_reached) OVER (ORDER BY step_number)                       AS prev_step_sessions,
        ROUND(100.0 * sessions_reached
              / LAG(sessions_reached) OVER (ORDER BY step_number), 1)          AS step_conversion_pct,
        LAG(sessions_reached) OVER (ORDER BY step_number) - sessions_reached    AS users_lost,
        ROUND(100.0 - 100.0 * sessions_reached
              / LAG(sessions_reached) OVER (ORDER BY step_number), 1)          AS step_dropoff_pct,
        ROUND(100.0 * sessions_reached
              / FIRST_VALUE(sessions_reached) OVER (ORDER BY step_number), 1)  AS pct_of_all_sessions
FROM    step_reach
ORDER BY step_number;


-- name: exit_screen_ranking
-- "Which screen do people leave from?" Ranked by abandoned carts and money.
-- Exit at step N = reached N but never reached N+1 (cart sessions only).
SELECT  furthest_step                                          AS step_number,
        exit_step,
        COUNT(*)                                               AS abandoned_carts,
        ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1)     AS share_of_all_abandonments_pct,
        ROUND(SUM(abandoned_value), 0)                         AS abandoned_gmv_eur,
        ROUND(AVG(order_total), 2)                             AS avg_basket_total_eur,
        RANK() OVER (ORDER BY COUNT(*) DESC)                   AS rank_by_volume
FROM    vw_session_funnel
WHERE   abandoned_cart = 1
GROUP BY furthest_step, exit_step
ORDER BY furthest_step;


-- name: headline_kpis
SELECT  COUNT(*)                                                          AS total_sessions,
        SUM(CASE WHEN furthest_step >= 2 THEN 1 ELSE 0 END)               AS sessions_with_cart,
        SUM(converted)                                                    AS orders,
        ROUND(100.0 * SUM(converted) / COUNT(*), 1)                       AS session_conversion_pct,
        ROUND(100.0 * SUM(abandoned_cart)
              / SUM(CASE WHEN furthest_step >= 2 THEN 1 ELSE 0 END), 1)   AS cart_abandonment_pct,
        ROUND(SUM(CASE WHEN converted = 1 THEN order_total END), 0)       AS gmv_eur,
        ROUND(AVG(CASE WHEN converted = 1 THEN order_total END), 2)       AS aov_eur,
        ROUND(SUM(abandoned_value), 0)                                    AS abandoned_gmv_eur
FROM    vw_session_funnel;


-- name: weekly_trend
-- Is the problem stable or getting worse? (weeks start Monday)
SELECT  DATE(session_date, '-' || ((CAST(STRFTIME('%w', session_date) AS INTEGER) + 6) % 7) || ' days') AS week_start,
        SUM(CASE WHEN furthest_step >= 2 THEN 1 ELSE 0 END)                AS carts,
        SUM(converted)                                                     AS orders,
        ROUND(100.0 * SUM(abandoned_cart)
              / SUM(CASE WHEN furthest_step >= 2 THEN 1 ELSE 0 END), 1)    AS cart_abandonment_pct,
        ROUND(100.0 * SUM(CASE WHEN furthest_step = 6 THEN 1 ELSE 0 END)
              / SUM(CASE WHEN furthest_step >= 6 THEN 1 ELSE 0 END), 1)    AS order_review_exit_pct
FROM    vw_session_funnel
GROUP BY week_start
ORDER BY week_start;
