"""
Trains the demand-forecasting model.  Run:  npm run ml:train   (after npm run ml:data)

THE IDEA IN PLAIN WORDS
  We show the computer many past (stall, day, hour) examples together with how many
  orders really happened. It learns the pattern, then predicts orders for new days.
  This is "regression" = predicting a NUMBER (orders), not a category.

STEPS
  1. Load history and build features (previous demand, weekday, hour...).
  2. Split into TRAIN (older days) and TEST (newest days).
     We split by TIME, not randomly: in real life we predict the future from the past,
     so the test must be "the future" the model has never seen.
  3. Train 2 models and compare with a simple baseline:
       baseline       : "tomorrow = same as last week"       (the score to beat)
       LinearRegression : draws a straight-line relationship  (simple, fast)
       RandomForest     : many decision trees voting           (handles curves like lunch peaks)
  4. Measure each on the TEST set with:
       MAE  = average mistake in orders           (lower is better, easy to explain)
       RMSE = like MAE but punishes big mistakes  (lower is better)
       R2   = 1.0 perfect, 0.0 = no better than guessing the average
  5. Re-train the winner on ALL data and save it with joblib.
"""
import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from features import CATEGORICAL, FEATURES, NUMERIC, TARGET, add_history_features

HERE = Path(__file__).parent
TEST_DAYS = 21  # newest 3 weeks are held out for testing


def make_pipeline(model) -> Pipeline:
    # One-hot turns "stall 3" / "Tuesday" / "1pm" into 0/1 columns so a model can't wrongly
    # think "stall 4 is twice stall 2". Numeric columns (previous demand) pass through as-is.
    prep = ColumnTransformer([("cat", OneHotEncoder(handle_unknown="ignore"), CATEGORICAL)], remainder="passthrough")
    return Pipeline([("prep", prep), ("model", model)])


def score(y_true, y_pred) -> dict:
    return {
        "MAE": round(float(mean_absolute_error(y_true, y_pred)), 3),
        "RMSE": round(float(np.sqrt(mean_squared_error(y_true, y_pred))), 3),
        "R2": round(float(r2_score(y_true, y_pred)), 3),
    }


def train(csv_path: str, model_path: str, metrics_path: str, test_days: int = TEST_DAYS) -> dict:
    raw = pd.read_csv(csv_path)
    df = add_history_features(raw).dropna(subset=NUMERIC)  # first 7 days have no history -> drop
    cutoff = df["date"].max() - pd.Timedelta(days=test_days)
    train_df, test_df = df[df["date"] <= cutoff], df[df["date"] > cutoff]
    X_train, y_train, X_test, y_test = train_df[FEATURES], train_df[TARGET], test_df[FEATURES], test_df[TARGET]

    candidates = {
        "linear_regression": make_pipeline(LinearRegression()),
        "random_forest": make_pipeline(RandomForestRegressor(n_estimators=200, min_samples_leaf=3, random_state=42, n_jobs=-1)),
    }
    results = {"baseline_same_as_last_week": score(y_test, test_df["lag7"])}
    for name, pipe in candidates.items():
        pipe.fit(X_train, y_train)
        results[name] = score(y_test, np.clip(pipe.predict(X_test), 0, None))

    best = min(candidates, key=lambda n: results[n]["MAE"])
    final = candidates[best].fit(df[FEATURES], df[TARGET])  # re-train on everything for deployment

    Path(model_path).parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": final, "features": FEATURES, "name": best}, model_path)
    report = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "best_model": best,
        "rows_train": int(len(train_df)), "rows_test": int(len(test_df)),
        "data_is_synthetic": bool(raw["is_synthetic"].all()) if "is_synthetic" in raw else False,
        "test_metrics": results,
    }
    Path(metrics_path).write_text(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default=str(HERE / "data" / "synthetic_orders.csv"))
    ap.add_argument("--model", default=str(HERE / "model" / "demand_model.joblib"))
    ap.add_argument("--metrics", default=str(HERE / "model" / "metrics.json"))
    a = ap.parse_args()
    rep = train(a.data, a.model, a.metrics)
    print(f"Train rows: {rep['rows_train']}   Test rows: {rep['rows_test']}   (synthetic data: {rep['data_is_synthetic']})\n")
    print(f"{'model':30s} {'MAE':>7s} {'RMSE':>7s} {'R2':>7s}")
    for name, m in rep["test_metrics"].items():
        print(f"{name:30s} {m['MAE']:7.3f} {m['RMSE']:7.3f} {m['R2']:7.3f}")
    print(f"\nBest model: {rep['best_model']}  -> saved to {a.model}")
