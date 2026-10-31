"""
Shared by training and prediction, so both build the model's inputs the SAME way.

What does the model look at? For one stall, one hour of one day:
  stall_id      which stall (each stall has its own popularity)
  day_of_week   0 = Monday ... 6 = Sunday
  hour          9..16 (canteen hours)
  lag1          orders at the same stall + hour YESTERDAY      (previous demand)
  lag7          orders at the same stall + hour SAME WEEKDAY LAST WEEK
  avg7          average orders at the same stall + hour over the last 7 days

All of these are known the day before, which is what lets us forecast TOMORROW.
"""
import pandas as pd

HOURS = list(range(9, 17))
CATEGORICAL = ["stall_id", "day_of_week", "hour"]
NUMERIC = ["lag1", "lag7", "avg7"]
FEATURES = CATEGORICAL + NUMERIC
TARGET = "orders"


def add_history_features(df: pd.DataFrame) -> pd.DataFrame:
    """Adds lag1 / lag7 / avg7 columns to a table with one row per (date, stall_id, hour)."""
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values(["stall_id", "hour", "date"]).reset_index(drop=True)
    g = df.groupby(["stall_id", "hour"])["orders"]
    df["lag1"] = g.shift(1)  # shift(1) = "the row before this one" = yesterday
    df["lag7"] = g.shift(7)  # 7 rows before = same weekday last week
    # rolling mean of the PREVIOUS 7 days (shift first so today's value never leaks in)
    df["avg7"] = g.transform(lambda s: s.shift(1).rolling(7).mean())
    df["day_of_week"] = df["date"].dt.dayofweek
    return df
