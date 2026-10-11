"""
Generate a realistic synthetic clickstream dataset for "Hungrly", a fictional
European food & grocery delivery app.

The data simulates 6 months (Apr-Sep 2026) of sessions moving through an
8-step checkout funnel. Behavioural drivers are deliberately embedded so the
analysis has real signal to find (and noise to fight through):

  * Fee shock        - delivery/service/small-order fees are revealed only at
                       the Order Review step; abandonment there rises with the
                       fee-to-basket ratio.
  * Broken promises  - promo codes that fail (expired, min-spend not met,
                       category excluded) spike abandonment at Order Review.
  * Login wall       - new users on web are forced to create an account at
                       Checkout Start (no guest checkout).
  * Long ETAs        - late-night and peak-dinner orders get long delivery
                       ETAs / no slots at Delivery Details.
  * Payment friction - mobile web has no wallet pay (Apple/Google Pay) and a
                       3-D Secure redirect, so card payments fail more often.

Run:  python src/generate_data.py
Out:  data/raw/*.csv
"""

from pathlib import Path

import numpy as np
import pandas as pd

SEED = 42
N_USERS = 62_000
N_SESSIONS = 185_000
START = pd.Timestamp("2026-04-01")
END = pd.Timestamp("2026-09-30 23:59:59")

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "raw"

rng = np.random.default_rng(SEED)

STEPS = [
    (1, "store_view", "Store / Menu View"),
    (2, "add_to_cart", "Add to Cart"),
    (3, "cart_view", "Cart View"),
    (4, "checkout_start", "Checkout Start"),
    (5, "delivery_details", "Delivery Details"),
    (6, "order_review", "Order Review"),
    (7, "payment", "Payment"),
    (8, "order_placed", "Order Placed"),
]

CITIES = {  # city: (share, base delivery fee EUR, ETA multiplier)
    "Berlin": (0.24, 1.99, 1.00),
    "Paris": (0.22, 2.49, 1.10),
    "Madrid": (0.17, 1.79, 0.95),
    "Amsterdam": (0.13, 2.29, 0.90),
    "Milan": (0.13, 1.99, 1.05),
    "Dublin": (0.11, 2.99, 1.15),
}

CATEGORIES = {  # category: (share, lognormal median basket EUR, sigma)
    "Fast Food": (0.27, 17.0, 0.40),
    "Restaurants": (0.24, 31.0, 0.38),
    "Groceries": (0.21, 44.0, 0.45),
    "Desserts & Coffee": (0.11, 12.5, 0.38),
    "Pharmacy & Beauty": (0.09, 24.0, 0.45),
    "Alcohol & Drinks": (0.08, 33.0, 0.40),
}

PLATFORMS = {  # platform: (share, device_type)
    "iOS App": (0.33, "Mobile"),
    "Android App": (0.27, "Mobile"),
    "Mobile Web": (0.25, "Mobile"),
    "Desktop Web": (0.12, "Desktop"),
    "Tablet App": (0.03, "Tablet"),
}

SOURCES = {  # source: (share, P(arrives with promo code))
    "Direct / Organic": (0.38, 0.08),
    "Push Notification": (0.18, 0.35),
    "Email Campaign": (0.10, 0.60),
    "Paid Social": (0.17, 0.45),
    "Paid Search": (0.12, 0.12),
    "Referral": (0.05, 0.50),
}


def pick(options: dict, n: int, idx: int = 0) -> np.ndarray:
    keys = list(options)
    p = np.array([v[idx] if isinstance(v, tuple) else v for v in options.values()])
    return rng.choice(keys, size=n, p=p / p.sum())


def sigmoid(x):
    return 1 / (1 + np.exp(-x))


# --------------------------------------------------------------------------
# Users
# --------------------------------------------------------------------------
users = pd.DataFrame({"user_id": [f"U{i:06d}" for i in range(1, N_USERS + 1)]})
users["home_city"] = pick(CITIES, N_USERS)
users["preferred_platform"] = pick(PLATFORMS, N_USERS)
users["is_plus_member"] = rng.random(N_USERS) < 0.14  # subscription: free delivery
# activity weight -> some users are heavy users
users["activity"] = rng.pareto(1.6, N_USERS) + 1

# --------------------------------------------------------------------------
# Sessions: timestamps with daily, weekly and hourly seasonality
# --------------------------------------------------------------------------
days = pd.date_range(START.normalize(), END.normalize(), freq="D")
dow_w = np.array([0.88, 0.86, 0.92, 0.98, 1.18, 1.25, 1.13])  # Mon..Sun
trend = np.linspace(0.92, 1.10, len(days))  # gentle growth
summer_dip = 1 - 0.08 * np.exp(-((np.arange(len(days)) - 125) / 14) ** 2)  # Aug holidays
day_w = dow_w[days.dayofweek] * trend * summer_dip
session_day = rng.choice(len(days), size=N_SESSIONS, p=day_w / day_w.sum())

hour_w = np.array([
    1.6, 1.1, 0.6, 0.3, 0.2, 0.2, 0.4, 0.9, 1.4, 1.8, 2.6, 4.6,
    6.3, 5.4, 3.2, 2.6, 3.0, 4.6, 7.4, 8.6, 7.6, 5.4, 3.6, 2.4,
])
session_hour = rng.choice(24, size=N_SESSIONS, p=hour_w / hour_w.sum())
session_start = (
    days[session_day]
    + pd.to_timedelta(session_hour, unit="h")
    + pd.to_timedelta(rng.integers(0, 3600, N_SESSIONS), unit="s")
)

uidx = rng.choice(N_USERS, size=N_SESSIONS, p=(users["activity"] / users["activity"].sum()).to_numpy())
s = pd.DataFrame({
    "session_id": [f"S{i:07d}" for i in range(1, N_SESSIONS + 1)],
    "user_id": users["user_id"].to_numpy()[uidx],
    "session_start": session_start,
})
# platform: mostly the user's preferred one, sometimes another
pref = users["preferred_platform"].to_numpy()[uidx]
other = pick(PLATFORMS, N_SESSIONS)
s["platform"] = np.where(rng.random(N_SESSIONS) < 0.82, pref, other)
s["device_type"] = s["platform"].map({k: v[1] for k, v in PLATFORMS.items()})
s["city"] = np.where(rng.random(N_SESSIONS) < 0.96, users["home_city"].to_numpy()[uidx], pick(CITIES, N_SESSIONS))
s["traffic_source"] = pick(SOURCES, N_SESSIONS)
s["is_plus_member"] = users["is_plus_member"].to_numpy()[uidx]

s = s.sort_values("session_start").reset_index(drop=True)
# first-ever session of a user (and their first orders) = new customer
s["user_session_number"] = s.groupby("user_id").cumcount() + 1
s["is_new_user"] = s["user_session_number"] == 1
n = len(s)

hour = s["session_start"].dt.hour.to_numpy()
dow = s["session_start"].dt.dayofweek.to_numpy()
is_app = s["platform"].str.contains("App").to_numpy()
is_mweb = (s["platform"] == "Mobile Web").to_numpy()
is_desktop = (s["platform"] == "Desktop Web").to_numpy()
is_new = s["is_new_user"].to_numpy()
is_plus = s["is_plus_member"].to_numpy()
late_night = (hour >= 23) | (hour <= 4)
dinner_peak = (hour >= 18) & (hour <= 20) & (dow >= 4)

# --------------------------------------------------------------------------
# Basket attributes (decided up front; only observed once a cart exists)
# --------------------------------------------------------------------------
cat = pick(CATEGORIES, n)
# late night skews to fast food / desserts, weekends to groceries
cat = np.where(late_night & (rng.random(n) < 0.35), "Fast Food", cat)
s["primary_category"] = cat
median = np.array([CATEGORIES[c][1] for c in cat])
sigma = np.array([CATEGORIES[c][2] for c in cat])
subtotal = np.round(np.exp(np.log(median) + sigma * rng.standard_normal(n)), 2)
subtotal = np.clip(subtotal, 4.5, 260)
s["cart_subtotal"] = subtotal
s["items_in_cart"] = np.maximum(1, np.round(subtotal / rng.uniform(6, 11, n))).astype(int)

base_fee = s["city"].map({k: v[1] for k, v in CITIES.items()}).to_numpy()
distance_km = np.round(rng.gamma(2.2, 1.3, n), 1)
delivery_fee = base_fee + np.where(distance_km > 4, 1.0, 0) + np.where(distance_km > 7, 1.5, 0)
delivery_fee = delivery_fee + np.where(dinner_peak | late_night, 1.0, 0.0)  # surge
delivery_fee = np.where((cat == "Groceries") & (subtotal >= 40), 0.0, delivery_fee)  # free over 40
delivery_fee = np.where(is_plus & (subtotal >= 15), 0.0, delivery_fee)
service_fee = np.clip(np.round(subtotal * 0.06, 2), 0.49, 2.99)
small_order_fee = np.where(subtotal < 15, np.round(15 - subtotal, 2).clip(0, 4.0), 0.0)
s["distance_km"] = distance_km
s["delivery_fee"] = np.round(delivery_fee, 2)
s["service_fee"] = service_fee
s["small_order_fee"] = small_order_fee
total_fees = s["delivery_fee"] + s["service_fee"] + s["small_order_fee"]
fee_ratio = (total_fees / s["cart_subtotal"]).to_numpy()

# promo codes: arrive with campaign; validity decided by rules
promo_p = s["traffic_source"].map({k: v[1] for k, v in SOURCES.items()}).to_numpy()
has_promo = rng.random(n) < promo_p
min_spend_fail = has_promo & (subtotal < 20) & (rng.random(n) < 0.55)
expired_fail = has_promo & ~min_spend_fail & (rng.random(n) < 0.11)
excluded_fail = has_promo & ~min_spend_fail & ~expired_fail & np.isin(cat, ["Alcohol & Drinks", "Pharmacy & Beauty"]) & (rng.random(n) < 0.6)
promo_status = np.full(n, "No Promo", dtype=object)
promo_status[has_promo] = "Applied"
promo_status[min_spend_fail] = "Failed - Min Spend Not Met"
promo_status[expired_fail] = "Failed - Expired"
promo_status[excluded_fail] = "Failed - Category Excluded"
promo_failed = np.char.startswith(promo_status.astype(str), "Failed")
discount = np.where(promo_status == "Applied", np.round(np.minimum(subtotal * 0.20, 10.0), 2), 0.0)
s["promo_status"] = promo_status
s["discount_amount"] = discount
s["order_total"] = np.round(s["cart_subtotal"] + total_fees - s["discount_amount"], 2)

# delivery ETA (minutes)
eta_mult = s["city"].map({k: v[2] for k, v in CITIES.items()}).to_numpy()
eta = (22 + distance_km * 3.2) * eta_mult + np.where(dinner_peak, 14, 0) + np.where(late_night, 17, 0)
eta = eta + np.where(cat == "Groceries", 8, 0) + rng.normal(0, 6, n)
s["delivery_eta_min"] = np.clip(np.round(eta), 12, 110).astype(int)
eta = s["delivery_eta_min"].to_numpy()

# payment method chosen
pm = np.empty(n, dtype=object)
r = rng.random(n)
pm[is_app] = np.where(r[is_app] < 0.52, "Apple / Google Pay", np.where(r[is_app] < 0.84, "Card", "PayPal"))
pm[~is_app] = np.where(r[~is_app] < 0.66, "Card", np.where(r[~is_app] < 0.93, "PayPal", "Apple / Google Pay"))
pm[is_mweb & (pm == "Apple / Google Pay")] = "Card"  # wallet pay not supported on mobile web
s["payment_method"] = pm

# --------------------------------------------------------------------------
# Funnel progression - step-level continuation probabilities
# --------------------------------------------------------------------------
noise = lambda: rng.normal(0, 0.15, n)  # unobserved heterogeneity

# 1 -> 2  browse -> add to cart
p_add = sigmoid(0.25 + 0.45 * ~is_new + 0.30 * is_app - 0.35 * is_desktop
                + 0.35 * has_promo - 0.25 * late_night + noise())
# 2 -> 3  open cart
p_cart = sigmoid(2.00 + 0.25 * is_app + noise())
# 3 -> 4  start checkout (cart review: removing items, comparing)
p_checkout = sigmoid(1.75 + 0.25 * ~is_new - 0.30 * (subtotal > 80) + noise())
# 4 -> 5  login wall: no guest checkout on web for new users
login_wall = is_new & ~is_app
p_details = sigmoid(2.55 - 1.85 * login_wall - 0.45 * (is_new & is_app) + noise())
# 5 -> 6  delivery details: long ETAs / no slots
p_review = sigmoid(2.75 - 0.042 * np.maximum(eta - 35, 0) - 0.55 * late_night
                   - 0.50 * (cat == "Alcohol & Drinks") + noise())  # age-verification step
# 6 -> 7  order review: fees + promo revealed here
p_pay = sigmoid(2.05 - 5.2 * np.minimum(fee_ratio, 0.6) - 1.55 * promo_failed
                + 0.30 * (promo_status == "Applied") + 0.45 * is_plus
                + 0.25 * ~is_new - 0.25 * late_night + noise())
# 7 -> 8  payment: wallet pay on app, card + 3DS redirect on mobile web
pay_fail_p = np.select(
    [pm == "Apple / Google Pay", (pm == "Card") & is_mweb, pm == "Card", pm == "PayPal"],
    [0.03, 0.24, 0.10, 0.07], 0.08,
)
payment_failed_first = rng.random(n) < pay_fail_p
retry_success = rng.random(n) < np.where(is_mweb, 0.38, 0.62)
p_place_given_no_fail = sigmoid(3.0 - 0.45 * is_mweb - 0.2 * is_desktop + noise())
p_place = np.where(payment_failed_first, retry_success * p_place_given_no_fail, p_place_given_no_fail)

cont = np.column_stack([p_add, p_cart, p_checkout, p_details, p_review, p_pay, p_place])
draws = rng.random(cont.shape) < cont
furthest = 1 + np.cumprod(draws, axis=1).sum(axis=1)  # 1..8
s["furthest_step"] = furthest
s["converted"] = furthest == 8
s["payment_error_shown"] = payment_failed_first & (furthest >= 7)

# --------------------------------------------------------------------------
# Events (long format) with realistic step timing
# --------------------------------------------------------------------------
step_secs = {  # median seconds spent before next step, lognormal sigma
    2: (95, 0.8), 3: (25, 0.7), 4: (40, 0.7), 5: (35, 0.6),
    6: (45, 0.6), 7: (30, 0.6), 8: (35, 0.6),
}
gaps = {}
for num, (med, sg) in step_secs.items():
    gaps[num] = np.exp(np.log(med) + sg * rng.standard_normal(n))
gaps[7] = gaps[7] * (1 + 1.2 * np.minimum(fee_ratio, 0.6))  # users stare at high fees longer

rows = []
start_ns = s["session_start"].to_numpy()
offset = np.zeros(n)
for num, name, label in STEPS:
    mask = furthest >= num
    if num > 1:
        offset = offset + gaps[num]
    # micro-events land part-way between this step and the next one
    micro_offset = offset + 0.4 * gaps.get(num + 1, np.full(n, 30.0))
    ts = start_ns[mask] + (offset[mask] * 1e9).astype("timedelta64[ns]")
    rows.append(pd.DataFrame({
        "session_id": s.loc[mask, "session_id"].to_numpy(),
        "event_name": name,
        "step_number": num,
        "event_ts": ts,
    }))
    # micro-events
    if num == 6:
        pm_mask = mask & has_promo
        rows.append(pd.DataFrame({
            "session_id": s.loc[pm_mask, "session_id"].to_numpy(),
            "event_name": np.where(promo_failed[pm_mask], "promo_code_failed", "promo_code_applied"),
            "step_number": 6,
            "event_ts": start_ns[pm_mask] + (micro_offset[pm_mask] * 1e9).astype("timedelta64[ns]"),
        }))
    if num == 7:
        pf_mask = mask & payment_failed_first
        rows.append(pd.DataFrame({
            "session_id": s.loc[pf_mask, "session_id"].to_numpy(),
            "event_name": "payment_failed",
            "step_number": 7,
            "event_ts": start_ns[pf_mask] + (micro_offset[pf_mask] * 1e9).astype("timedelta64[ns]"),
        }))

events = pd.concat(rows, ignore_index=True).sort_values(["session_id", "event_ts"]).reset_index(drop=True)
events.insert(0, "event_id", [f"E{i:08d}" for i in range(1, len(events) + 1)])
events["event_ts"] = events["event_ts"].dt.floor("s")

# --------------------------------------------------------------------------
# Output tables
# --------------------------------------------------------------------------
sessions_out = s[[
    "session_id", "user_id", "session_start", "platform", "device_type", "city",
    "traffic_source", "is_new_user", "is_plus_member",
]].copy()
sessions_out["session_start"] = sessions_out["session_start"].dt.floor("s")

has_cart = furthest >= 2
carts_out = s.loc[has_cart, [
    "session_id", "primary_category", "items_in_cart", "cart_subtotal", "delivery_fee",
    "service_fee", "small_order_fee", "promo_status", "discount_amount", "order_total",
    "distance_km", "delivery_eta_min", "payment_method",
]].copy()

orders_out = s.loc[s["converted"], ["session_id", "user_id", "order_total", "payment_method"]].copy()
orders_out.insert(0, "order_id", [f"O{i:07d}" for i in range(1, len(orders_out) + 1)])
placed_ts = events.loc[events["event_name"] == "order_placed", ["session_id", "event_ts"]]
orders_out = orders_out.merge(placed_ts, on="session_id").rename(columns={"event_ts": "order_ts"})

users_out = users[["user_id", "home_city", "is_plus_member"]].copy()
first_seen = s.groupby("user_id")["session_start"].min().dt.date.rename("first_seen_date")
users_out = users_out.merge(first_seen, on="user_id", how="inner")

steps_out = pd.DataFrame(STEPS, columns=["step_number", "event_name", "step_label"])

OUT.mkdir(parents=True, exist_ok=True)
users_out.to_csv(OUT / "users.csv", index=False)
sessions_out.to_csv(OUT / "sessions.csv", index=False)
carts_out.to_csv(OUT / "carts.csv", index=False)
events.to_csv(OUT / "events.csv", index=False)
orders_out.to_csv(OUT / "orders.csv", index=False)
steps_out.to_csv(OUT / "funnel_steps.csv", index=False)

print(f"users     {len(users_out):>9,}")
print(f"sessions  {len(sessions_out):>9,}")
print(f"carts     {len(carts_out):>9,}")
print(f"events    {len(events):>9,}")
print(f"orders    {len(orders_out):>9,}")
print("\nFunnel (sessions reaching step):")
for num, name, label in STEPS:
    k = (furthest >= num).sum()
    print(f"  {num}. {label:<18} {k:>8,}  ({k / n:6.1%})")
print(f"\nCart -> order conversion: {s['converted'].sum() / has_cart.sum():.1%}")
