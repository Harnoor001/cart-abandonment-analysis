-- =====================================================================
-- 04_root_cause.sql
-- Q: WHY do people leave at the worst steps?
--    Order Review is where fees and promo results are first revealed.
-- =====================================================================

-- name: review_exit_by_fee_ratio
-- "Fee shock": exit rate at Order Review vs fees as a % of basket.
SELECT  CASE
            WHEN fee_ratio < 0.05 THEN '01. <5%'
            WHEN fee_ratio < 0.10 THEN '02. 5-10%'
            WHEN fee_ratio < 0.15 THEN '03. 10-15%'
            WHEN fee_ratio < 0.20 THEN '04. 15-20%'
            WHEN fee_ratio < 0.30 THEN '05. 20-30%'
            WHEN fee_ratio < 0.40 THEN '06. 30-40%'
            ELSE                       '07. 40%+'
        END                                                                AS fee_ratio_band,
        COUNT(*)                                                           AS reached_review,
        SUM(CASE WHEN furthest_step = 6 THEN 1 ELSE 0 END)                 AS exited_at_review,
        ROUND(100.0 * SUM(CASE WHEN furthest_step = 6 THEN 1 ELSE 0 END) / COUNT(*), 1) AS review_exit_pct,
        ROUND(AVG(cart_subtotal), 2)                                       AS avg_subtotal_eur,
        ROUND(AVG(total_fees), 2)                                          AS avg_fees_eur
FROM    vw_session_funnel
WHERE   furthest_step >= 6
GROUP BY fee_ratio_band
ORDER BY fee_ratio_band;


-- name: review_exit_by_basket_size
-- Small baskets trigger the small-order fee: the sharpest cliff.
SELECT  CASE
            WHEN cart_subtotal < 10 THEN '01. < EUR 10'
            WHEN cart_subtotal < 15 THEN '02. EUR 10-15'
            WHEN cart_subtotal < 20 THEN '03. EUR 15-20'
            WHEN cart_subtotal < 30 THEN '04. EUR 20-30'
            WHEN cart_subtotal < 50 THEN '05. EUR 30-50'
            ELSE                         '06. EUR 50+'
        END                                                                AS basket_band,
        COUNT(*)                                                           AS reached_review,
        ROUND(100.0 * SUM(CASE WHEN small_order_fee > 0 THEN 1 ELSE 0 END) / COUNT(*), 1) AS pct_with_small_order_fee,
        ROUND(AVG(total_fees), 2)                                          AS avg_fees_eur,
        ROUND(100.0 * AVG(fee_ratio), 1)                                   AS avg_fee_ratio_pct,
        ROUND(100.0 * SUM(CASE WHEN furthest_step = 6 THEN 1 ELSE 0 END) / COUNT(*), 1) AS review_exit_pct
FROM    vw_session_funnel
WHERE   furthest_step >= 6
GROUP BY basket_band
ORDER BY basket_band;


-- name: review_exit_by_promo
-- "Broken promise": a promo code that fails at the last screen.
SELECT  promo_status,
        COUNT(*)                                                           AS reached_review,
        SUM(CASE WHEN furthest_step = 6 THEN 1 ELSE 0 END)                 AS exited_at_review,
        ROUND(100.0 * SUM(CASE WHEN furthest_step = 6 THEN 1 ELSE 0 END) / COUNT(*), 1) AS review_exit_pct,
        ROUND(SUM(CASE WHEN furthest_step = 6 THEN order_total ELSE 0 END), 0) AS abandoned_gmv_eur
FROM    vw_session_funnel
WHERE   furthest_step >= 6
GROUP BY promo_status
ORDER BY review_exit_pct DESC;


-- name: checkout_start_login_wall
-- New web users hit a forced sign-up at Checkout Start (no guest checkout).
SELECT  CASE WHEN platform LIKE '%App' THEN 'App' ELSE 'Web' END          AS channel,
        CASE WHEN is_new_user = 1 THEN 'New' ELSE 'Returning' END          AS customer_type,
        COUNT(*)                                                           AS reached_checkout_start,
        ROUND(100.0 * SUM(CASE WHEN furthest_step = 4 THEN 1 ELSE 0 END) / COUNT(*), 1) AS checkout_start_exit_pct
FROM    vw_session_funnel
WHERE   furthest_step >= 4
GROUP BY channel, customer_type
ORDER BY checkout_start_exit_pct DESC;


-- name: delivery_exit_by_eta
-- Long delivery ETAs shown at Delivery Details.
SELECT  CASE
            WHEN delivery_eta_min < 30 THEN '01. <30 min'
            WHEN delivery_eta_min < 40 THEN '02. 30-39 min'
            WHEN delivery_eta_min < 50 THEN '03. 40-49 min'
            WHEN delivery_eta_min < 60 THEN '04. 50-59 min'
            ELSE                            '05. 60+ min'
        END                                                                AS eta_band,
        COUNT(*)                                                           AS reached_delivery_details,
        ROUND(100.0 * SUM(CASE WHEN furthest_step = 5 THEN 1 ELSE 0 END) / COUNT(*), 1) AS delivery_exit_pct
FROM    vw_session_funnel
WHERE   furthest_step >= 5
GROUP BY eta_band
ORDER BY eta_band;

