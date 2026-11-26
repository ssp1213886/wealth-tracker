CREATE TABLE IF NOT EXISTS ma_cross_state (
  user_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  period INTEGER NOT NULL,
  side TEXT NOT NULL,
  price REAL NOT NULL,
  average REAL NOT NULL,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, symbol, period)
);

CREATE TABLE IF NOT EXISTS ma_cross_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  period INTEGER NOT NULL,
  from_side TEXT NOT NULL,
  to_side TEXT NOT NULL,
  price REAL NOT NULL,
  average REAL NOT NULL,
  triggered_at INTEGER NOT NULL,
  acked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_ma_cross_events_user
  ON ma_cross_events(user_id, acked_at, triggered_at DESC);
