"""End-to-end check of the ML pipeline: generate -> train -> predict."""
from datetime import date, timedelta

import pytest

from features import HOURS, add_history_features
from generate_synthetic_data import generate
from predict import predict
from train_model import train


@pytest.fixture(scope="module")
def trained(tmp_path_factory):
    d = tmp_path_factory.mktemp("ml")
    csv = d / "orders.csv"
    generate(days=90, seed=1, end_date=date(2026, 3, 1)).to_csv(csv, index=False)
    report = train(str(csv), str(d / "m.joblib"), str(d / "metrics.json"))
    return d, csv, report


def test_synthetic_data_is_marked_and_shaped():
    df = generate(days=10, seed=1)
    assert df["is_synthetic"].all()
    assert len(df) == 10 * 4 * len(HOURS)
    assert (df["orders"] >= 0).all()


def test_generator_is_reproducible():
    assert generate(days=5, seed=7).equals(generate(days=5, seed=7))


def test_lag_features_do_not_leak_today():
    df = add_history_features(generate(days=20, seed=3))
    row = df[(df.stall_id == 1) & (df.hour == 11)].reset_index(drop=True)
    assert row.loc[10, "lag1"] == row.loc[9, "orders"]  # lag1 is YESTERDAY's value
    assert row.loc[10, "lag7"] == row.loc[3, "orders"]


def test_model_beats_naive_baseline(trained):
    m = trained[2]["test_metrics"]
    best = trained[2]["best_model"]
    assert m[best]["R2"] > 0.6, m
    assert m[best]["MAE"] < m["baseline_same_as_last_week"]["MAE"], m  # must beat "same as last week"


def test_predict_output_shape_and_values(trained):
    d, csv, _ = trained
    out = predict(str(d / "m.joblib"), str(csv), date(2026, 3, 3))
    assert out["target_date"] == "2026-03-03" and out["data_source"] == "synthetic"
    assert [s["stall_id"] for s in out["stalls"]] == [1, 2, 3, 4]
    for s in out["stalls"]:
        assert len(s["hourly"]) == len(HOURS)
        assert all(h["predicted_orders"] >= 0 for h in s["hourly"])
        assert s["peak_hour"] in HOURS and s["total_orders"] > 0


def test_weekend_forecast_is_lower_than_weekday(trained):
    d, csv, _ = trained
    weekday = predict(str(d / "m.joblib"), str(csv), date(2026, 3, 3))  # Tuesday
    sunday = predict(str(d / "m.joblib"), str(csv), date(2026, 3, 8))
    assert sum(s["total_orders"] for s in sunday["stalls"]) < 0.5 * sum(s["total_orders"] for s in weekday["stalls"])
