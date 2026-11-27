-- 把老的单用户 data(key) 表升级成多用户 data(user_id, key)。
-- 只在"库还是旧结构"时执行一次；新库直接用 schema.sql（已经是复合主键）。
-- 执行前请先备份：npx wrangler d1 export wealth-db --remote --output backup.sql

-- 1) 老数据默认归属 1 号账号（与旧版"没带 cookie 就按 1 号库"的行为一致）
ALTER TABLE data RENAME TO data_legacy_single_user;

CREATE TABLE data (
  user_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (user_id, key)
);

INSERT INTO data (user_id, key, value, updated_at)
SELECT 1, key, value,
       CASE WHEN updated_at < 100000000000 THEN updated_at * 1000 ELSE updated_at END
FROM data_legacy_single_user;

CREATE INDEX IF NOT EXISTS idx_data_user ON data(user_id);

DROP TABLE data_legacy_single_user;

-- 校验：应该返回 data 的列定义，含 user_id
-- SELECT sql FROM sqlite_master WHERE name = 'data';
