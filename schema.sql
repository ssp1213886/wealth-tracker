-- Wealth Tracker · Cloudflare D1 结构
-- v442：与 src/lib/sync.js / accounts.js / snapshots.js 的真实用法对齐（都按 user_id 分区）。
-- 旧版本这里是单列主键 key，导致全新环境建库后所有查询报 "no such column: user_id"。
-- 已有库请用 migrations/2026-11-27-data-user-id.sql 迁移，不要重跑本文件。

CREATE TABLE IF NOT EXISTS data (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_data_user ON data(user_id);

-- v305 方案 B：云端快照。清除全部数据前把当时的 data 行整份存一份，换设备也能恢复。
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  payload TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_user ON snapshots(user_id, created_at DESC);
