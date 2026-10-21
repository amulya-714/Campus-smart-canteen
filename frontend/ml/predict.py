"""
Predicts orders per stall per hour for ONE day (default: tomorrow).

Used two ways:
  * by hand:      npm run ml:predict -- --date 2026-10-21
  * by Next.js:   lib/services/forecast.ts runs this script and reads the JSON it writes.

Needs: the saved model (npm run ml:train) and order history (default: the synthetic CSV;
to use REAL data pass --history path/to/real_orders.csv with columns date, stall_id, hour, orders).
"""
import argparse
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from features import FEATURES, HOURS

HERE = Path(__file__).parent


def predict(model_path: str, history_csv: str, target: date) -> dict:
    bundle = joblib.load(model_path)
    model = bundle["model"]
    hist = pd.read_csv(history_csv)
    hist["date"] = pd.to_datetime(hist["date"]).dt.date
    lookup = {(r.stall_id, r.hour, r.date): r.orders for r in hist.itertuples()}  # (stall, hour, day) -> orders
    last_day = hist["date"].max()

    def recent_avg(stall, hour):
        vals = [lookup[(stall, hour, last_day - timedelta(days=k))] for k in range(7) if (stall, hour, last_day - timedelta(days=k)) in lookup]
        return float(np.mean(vals)) if vals else 0.0

    rows = []
    for stall in sorted(hist["stall_id"].unique()):
        for hour in HOURS:
            fallback = recent_avg(stall, hour)  # used when the exact earlier day is missing from history
            lag1 = lookup.get((stall, hour, target - timedelta(days=1)), fallback)
            lag7 = lookup.get((stall, hour, target - timedelta(days=7)), fallback)
            prev = [lookup[(stall, hour, target - timedelta(days=k))] for k in range(1, 8) if (stall, hour, target - timedelta(days=k)) in lookup]
            avg7 = float(np.mean(prev)) if prev else fallback
            rows.append({"stall_id": int(stall), "day_of_week": target.weekday(), "hour": hour, "lag1": lag1, "lag7": lag7, "avg7": avg7})

    X = pd.DataFrame(rows)
    X["pred"] = np.clip(model.predict(X[FEATURES]), 0, None)

    stalls = []
    for stall, part in X.groupby("stall_id"):
        hourly = [{"hour": int(r.hour), "predicted_orders": round(float(r.pred), 1)} for r in part.itertuples()]
        peak = max(hourly, key=lambda h: h["predicted_orders"])["hour"]
        stalls.append({"stall_id": int(stall), "total_orders": round(float(part["pred"].sum()), 1), "peak_hour": int(peak), "hourly": hourly})
    synthetic = bool(pd.read_csv(history_csv, nrows=5).get("is_synthetic", pd.Series([False])).all())
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "target_date": target.isoformat(),
        "model": bundle["name"],
        "data_source": "synthetic" if synthetic else "real",
        "stalls": stalls,
    }


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="YYYY-MM-DD (default: tomorrow)")
    ap.add_argument("--model", default=str(HERE / "model" / "demand_model.joblib"))
    ap.add_argument("--history", default=str(HERE / "data" / "synthetic_orders.csv"))
    ap.add_argument("--out", default=str(HERE / "model" / "forecast_latest.json"))
    a = ap.parse_args()
    target = date.fromisoformat(a.date) if a.date else date.today() + timedelta(days=1)
    result = predict(a.model, a.history, target)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(result, indent=2))
    print(json.dumps({k: v for k, v in result.items() if k != "stalls"}, indent=2))
    for s in result["stalls"]:
        print(f"stall {s['stall_id']}: ~{s['total_orders']} orders, peak at {s['peak_hour']}:00")
