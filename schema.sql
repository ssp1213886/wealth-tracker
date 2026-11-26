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
