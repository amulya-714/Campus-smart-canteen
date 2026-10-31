"""
!!! SYNTHETIC DATA GENERATOR  --  the numbers are INVENTED !!!

We have no real canteen history yet, so this script makes believable fake data.
Every row has is_synthetic=True. Once real orders exist, export them to the same
columns (date, stall_id, hour, orders) and retrain -- nothing else changes.

How the fake demand is built (so the model has real patterns to discover):
  expected orders = stall popularity x hour-of-day shape x day-of-week factor x slow growth
  actual orders   = a random "Poisson" draw around that expected value (adds natural noise)
  holidays        = a few random days with almost no orders (surprises the model can't predict)
"""
import argparse
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from features import HOURS

# How popular each stall is (stall ids match the seed data).
STALL_POPULARITY = {1: 1.0, 2: 0.9, 3: 1.5, 4: 0.8}
# Canteens are busiest at the breaks: ~11am (break) and ~1pm (lunch).
HOUR_SHAPE = {9: 0.4, 10: 0.9, 11: 3.2, 12: 2.6, 13: 4.0, 14: 1.8, 15: 1.6, 16: 0.8}
# Monday..Sunday
DAY_FACTOR = [1.1, 1.05, 1.0, 1.0, 0.85, 0.3, 0.05]
# Stall-specific twists: juices sell more in the afternoon heat, snacks spike at the breaks.
STALL_HOUR_BOOST = {(1, 14): 1.5, (1, 15): 1.5, (3, 11): 1.3, (3, 13): 1.3}


def generate(days: int = 120, seed: int = 42, end_date: date | None = None) -> pd.DataFrame:
    rng = np.random.default_rng(seed)  # fixed seed -> same data every run
    end = end_date or (date.today() - timedelta(days=1))  # history ends yesterday
    rows = []
    holidays = set(rng.choice(days, size=max(1, days // 25), replace=False))
    for d in range(days):
        day = end - timedelta(days=days - 1 - d)
        growth = 1 + 0.004 * d  # canteen slowly gets more popular
        holiday = d in holidays
        for stall, pop in STALL_POPULARITY.items():
            for hour in HOURS:
                lam = pop * HOUR_SHAPE[hour] * DAY_FACTOR[day.weekday()] * growth * STALL_HOUR_BOOST.get((stall, hour), 1.0) * 3
                if holiday:
                    lam *= 0.05
                rows.append({"date": day.isoformat(), "stall_id": stall, "hour": hour, "orders": int(rng.poisson(lam)), "is_synthetic": True})
    return pd.DataFrame(rows)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Generate SYNTHETIC order history")
    ap.add_argument("--days", type=int, default=120)
    ap.add_argument("--out", default=str(Path(__file__).parent / "data" / "synthetic_orders.csv"))
    args = ap.parse_args()
    df = generate(args.days)
    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False)
    print("*** SYNTHETIC DATA (invented numbers, not real orders) ***")
    print(f"Wrote {len(df)} rows ({args.days} days x {df.stall_id.nunique()} stalls x {len(HOURS)} hours) to {args.out}")
