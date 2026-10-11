-- =====================================================================
-- 01_schema.sql
-- Hungrly checkout analytics: raw tables + an analysis-ready session view.
-- Engine: SQLite 3.25+ (window functions). Portable to Postgres/BigQuery
-- with minor date-function changes.
-- =====================================================================

DROP VIEW  IF EXISTS vw_session_funnel;
DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS carts;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS funnel_steps;

CREATE TABLE users (
    user_id          TEXT PRIMARY KEY,
    home_city        TEXT,
    is_plus_member   INTEGER,          -- 1 = subscription with free delivery
    first_seen_date  TEXT
);

CREATE TABLE sessions (
    session_id       TEXT PRIMARY KEY,
    user_id          TEXT REFERENCES users(user_id),
    session_start    TEXT,             -- ISO-8601 timestamp
    platform         TEXT,             -- iOS App / Android App / Mobile Web / Desktop Web / Tablet App
    device_type      TEXT,             -- Mobile / Desktop / Tablet
    city             TEXT,
    traffic_source   TEXT,
    is_new_user      INTEGER,
    is_plus_member   INTEGER
);

-- One row per session that added at least one item to the cart
CREATE TABLE carts (
    session_id       TEXT PRIMARY KEY REFERENCES sessions(session_id),
    primary_category TEXT,
    items_in_cart    INTEGER,
    cart_subtotal    REAL,             -- EUR, before fees & discount
    delivery_fee     REAL,
    service_fee      REAL,
    small_order_fee  REAL,
    promo_status     TEXT,             -- No Promo / Applied / Failed - <reason>
    discount_amount  REAL,
    order_total      REAL,             -- what the customer sees at Order Review
    distance_km      REAL,
    delivery_eta_min INTEGER,
    payment_method   TEXT
);

CREATE TABLE orders (
    order_id         TEXT PRIMARY KEY,
    session_id       TEXT REFERENCES sessions(session_id),
    user_id          TEXT REFERENCES users(user_id),
    order_total      REAL,
    payment_method   TEXT,
    order_ts         TEXT
);

CREATE TABLE events (
    event_id         TEXT PRIMARY KEY,
    session_id       TEXT REFERENCES sessions(session_id),
    event_name       TEXT,
    step_number      INTEGER,
    event_ts         TEXT
);

CREATE TABLE funnel_steps (
    step_number      INTEGER PRIMARY KEY,
    event_name       TEXT,
    step_label       TEXT
);

-- ---------------------------------------------------------------------
-- vw_session_funnel: one row per session with its furthest funnel step,
-- the step it abandoned at, and all segmentation attributes.
-- This is the workhorse for every downstream query and for Power BI.
-- ---------------------------------------------------------------------
CREATE VIEW vw_session_funnel AS
WITH furthest AS (
    SELECT  e.session_id,
            MAX(e.step_number)                                     AS furthest_step,
            MAX(CASE WHEN e.event_name = 'promo_code_failed' THEN 1 ELSE 0 END) AS saw_promo_error,
            MAX(CASE WHEN e.event_name = 'payment_failed'    THEN 1 ELSE 0 END) AS saw_payment_error
    FROM    events e
    WHERE   e.event_name IN (SELECT event_name FROM funnel_steps)
         OR e.event_name IN ('promo_code_failed', 'payment_failed')
    GROUP BY e.session_id
)
SELECT  s.session_id,
        s.user_id,
        s.session_start,
        DATE(s.session_start)                                       AS session_date,
        CAST(STRFTIME('%H', s.session_start) AS INTEGER)            AS session_hour,
        CASE CAST(STRFTIME('%w', s.session_start) AS INTEGER)
             WHEN 0 THEN 'Sun' WHEN 1 THEN 'Mon' WHEN 2 THEN 'Tue' WHEN 3 THEN 'Wed'
             WHEN 4 THEN 'Thu' WHEN 5 THEN 'Fri' ELSE 'Sat' END     AS day_of_week,
        CASE
            WHEN CAST(STRFTIME('%H', s.session_start) AS INTEGER) BETWEEN 5  AND 10 THEN '1. Morning (05-10)'
            WHEN CAST(STRFTIME('%H', s.session_start) AS INTEGER) BETWEEN 11 AND 14 THEN '2. Lunch (11-14)'
            WHEN CAST(STRFTIME('%H', s.session_start) AS INTEGER) BETWEEN 15 AND 17 THEN '3. Afternoon (15-17)'
            WHEN CAST(STRFTIME('%H', s.session_start) AS INTEGER) BETWEEN 18 AND 22 THEN '4. Dinner (18-22)'
            ELSE '5. Late Night (23-04)'
        END                                                         AS time_of_day,
        s.platform,
        s.device_type,
        s.city,
        s.traffic_source,
        s.is_new_user,
        s.is_plus_member,
        c.primary_category,
        c.items_in_cart,
        c.cart_subtotal,
        c.delivery_fee,
        c.service_fee,
        c.small_order_fee,
        ROUND(c.delivery_fee + c.service_fee + c.small_order_fee, 2) AS total_fees,
        ROUND((c.delivery_fee + c.service_fee + c.small_order_fee) / c.cart_subtotal, 4) AS fee_ratio,
        c.promo_status,
        c.discount_amount,
        c.order_total,
        c.delivery_eta_min,
        c.payment_method,
        f.furthest_step,
        fs.step_label                                               AS furthest_step_label,
        CASE WHEN f.furthest_step = 8 THEN 1 ELSE 0 END             AS converted,
        -- the screen the user was on when they left (NULL if they ordered)
        CASE WHEN f.furthest_step < 8 THEN fs.step_label END        AS exit_step,
        -- cart abandonment = had a cart (step >= 2) but no order
        CASE WHEN f.furthest_step BETWEEN 2 AND 7 THEN 1 ELSE 0 END AS abandoned_cart,
        CASE WHEN f.furthest_step BETWEEN 2 AND 7 THEN c.order_total ELSE 0 END AS abandoned_value,
        f.saw_promo_error,
        f.saw_payment_error
FROM        sessions  s
JOIN        furthest  f  ON f.session_id = s.session_id
JOIN        funnel_steps fs ON fs.step_number = f.furthest_step
LEFT JOIN   carts     c  ON c.session_id = s.session_id;
