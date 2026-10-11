-- =====================================================================
-- 03_dropoff_by_segment.sql
-- Q: Does drop-off differ by device, product category, time of day,
--    new vs returning customer?
-- Step exit rate = sessions that left at step N / sessions that reached N
-- =====================================================================

-- name: segment_step_exit_rates
-- Long format: one row per (dimension, segment, step). Feeds heatmaps.
WITH seg AS (
    SELECT session_id, furthest_step, 'Device'      AS dimension, device_type      AS segment FROM vw_session_funnel UNION ALL
    SELECT session_id, furthest_step, 'Platform',                 platform                    FROM vw_session_funnel UNION ALL
    SELECT session_id, furthest_step, 'Category',                 primary_category            FROM vw_session_funnel WHERE primary_category IS NOT NULL UNION ALL
    SELECT session_id, furthest_step, 'Time of Day',              time_of_day                 FROM vw_session_funnel UNION ALL
    SELECT session_id, furthest_step, 'Customer Type',
           CASE WHEN is_new_user = 1 THEN 'New' ELSE 'Returning' END                          FROM vw_session_funnel
),
steps AS (SELECT step_number, step_label FROM funnel_steps WHERE step_number BETWEEN 2 AND 7)
SELECT  seg.dimension,
        seg.segment,
        st.step_number,
        st.step_label,
        SUM(CASE WHEN seg.furthest_step >= st.step_number THEN 1 ELSE 0 END) AS reached,
        SUM(CASE WHEN seg.furthest_step  = st.step_number THEN 1 ELSE 0 END) AS exited,
        ROUND(100.0 * SUM(CASE WHEN seg.furthest_step = st.step_number THEN 1 ELSE 0 END)
              / NULLIF(SUM(CASE WHEN seg.furthest_step >= st.step_number THEN 1 ELSE 0 END), 0), 1) AS exit_rate_pct
FROM    seg
CROSS JOIN steps st
GROUP BY seg.dimension, seg.segment, st.step_number, st.step_label
ORDER BY seg.dimension, seg.segment, st.step_number;


-- name: segment_summary
-- One row per segment: cart abandonment %, money left on the table,
-- and how far each segment sits from the overall rate (index = 100).
WITH seg AS (
    SELECT *, 'Device'   AS dimension, device_type      AS segment FROM vw_session_funnel WHERE furthest_step >= 2 UNION ALL
    SELECT *, 'Platform',               platform                    FROM vw_session_funnel WHERE furthest_step >= 2 UNION ALL
    SELECT *, 'Category',               primary_category            FROM vw_session_funnel WHERE furthest_step >= 2 UNION ALL
    SELECT *, 'Time of Day',            time_of_day                 FROM vw_session_funnel WHERE furthest_step >= 2 UNION ALL
    SELECT *, 'Customer Type', CASE WHEN is_new_user = 1 THEN 'New' ELSE 'Returning' END
                                                                    FROM vw_session_funnel WHERE furthest_step >= 2
),
overall AS (
    SELECT 1.0 * SUM(abandoned_cart) / COUNT(*) AS rate FROM vw_session_funnel WHERE furthest_step >= 2
)
SELECT  dimension,
        segment,
        COUNT(*)                                             AS carts,
        SUM(abandoned_cart)                                  AS abandoned_carts,
        ROUND(100.0 * SUM(abandoned_cart) / COUNT(*), 1)     AS cart_abandonment_pct,
        ROUND(100.0 * SUM(abandoned_cart) / COUNT(*) / (SELECT rate FROM overall), 0) AS index_vs_overall,
        ROUND(SUM(abandoned_value), 0)                       AS abandoned_gmv_eur,
        ROUND(AVG(order_total), 2)                           AS avg_basket_eur
FROM    seg
GROUP BY dimension, segment
ORDER BY dimension, cart_abandonment_pct DESC;


-- name: hourly_profile
-- Traffic vs abandonment by hour: when do carts die?
SELECT  session_hour,
        SUM(CASE WHEN furthest_step >= 2 THEN 1 ELSE 0 END)                   AS carts,
        ROUND(100.0 * SUM(abandoned_cart)
              / NULLIF(SUM(CASE WHEN furthest_step >= 2 THEN 1 ELSE 0 END), 0), 1) AS cart_abandonment_pct,
        ROUND(AVG(CASE WHEN furthest_step >= 5 THEN delivery_eta_min END), 1)  AS avg_eta_min,
        ROUND(100.0 * SUM(CASE WHEN furthest_step = 5 THEN 1 ELSE 0 END)
              / NULLIF(SUM(CASE WHEN furthest_step >= 5 THEN 1 ELSE 0 END), 0), 1) AS delivery_details_exit_pct
FROM    vw_session_funnel
GROUP BY session_hour
ORDER BY session_hour;


-- name: platform_payment_failures
-- Payment step: are failures concentrated on one platform / method?
SELECT  platform,
        payment_method,
        COUNT(*)                                                      AS reached_payment,
        ROUND(100.0 * SUM(saw_payment_error) / COUNT(*), 1)           AS payment_error_pct,
        ROUND(100.0 * SUM(CASE WHEN furthest_step = 7 THEN 1 ELSE 0 END) / COUNT(*), 1) AS payment_exit_pct
FROM    vw_session_funnel
WHERE   furthest_step >= 7
GROUP BY platform, payment_method
HAVING  COUNT(*) >= 200
ORDER BY payment_exit_pct DESC;
