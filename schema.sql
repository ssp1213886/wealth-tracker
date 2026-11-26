DROP TABLE IF EXISTS data;
CREATE TABLE data (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- v305 方案 B：云端快照。清除全部数据前把当时的 data 行整份存一份，换设备也能恢复。
-- 注意：线上是增量建表（CREATE TABLE IF NOT EXISTS），不要重跑上面的 DROP TABLE。
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  payload TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_user ON snapshots(user_id, created_at DESC);

-- 50/200 日均线穿越提醒：状态只在服务端保存；事件确认后跨设备消失。
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
CREATE INDEX IF NOT EXISTS idx_ma_cross_events_user ON ma_cross_events(user_id, acked_at, triggered_at DESC);
