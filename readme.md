# My Portfolio — 个人投资仪表盘

VGT + SMH + BTC 定投组合 + SGOV 备用金池。六页仪表盘、实时行情、纪律打卡、信号监测、云端同步、PWA 安装。

**线上地址**：`https://wealth-tracker.ssp2180481336.workers.dev`

---

## 页面结构

| 页面 | 功能 |
|---|---|
| 📊 仪表盘 | 总资产、异常检测（SMH 信号驱动 SGOV 建议）、本月定投目标、20年旅程、可配目标进度、高点回撤、持仓分布、仓位盈亏 |
| 🕹️ 操作台 | 买卖录入、年度再平衡（12/31 解锁，其余天可预览） |
| 🛡️ SGOV 池 | 实时市值+盈亏、SMH 信号监测（≥40% 回撤触发出击）、盾牌闪烁报警 |
| 📁 数据 | 现金管理、持仓明细、交易历史（筛选+排序）、资金流水（筛选+汇总） |
| 📓 日志 | 自动操作日志、纪律打卡热力图 |
| 🗺 规划 | 收入加码、退出策略（可配置组合）、提款模拟 |

---

## 特性

- 🌓 **亮色/暗色模式** + 5 种配色方案 · 暗色模式自动跟随系统
- 📱 **PWA**：可添加到手机主屏幕 · 离线缓存
- ☁️ **Cloudflare D1** 云端同步（自动上传/下载 · 手动配置 Token）
- 📈 **Yahoo Finance**实时价格 + 腾讯备选（VGT/SMH/BTC/SGOV）
- 📋 **CSV 导入**：Schwab 交易记录拖拽导入
- 📊 **纪律打卡**：月度定投热力图 + 连续月数统计
- ⚡ **SGOV 监测**：SMH 52周高回撤信号 + 盾牌报警
- 🎯 **可配置参数**：月投额、起始日期、年龄、财务目标
- 💾 **JSON 导入/导出**：数据备份与恢复
- ↩️ **操作撤销**：清空全部交易/流水支持一键撤销

---

## 技术栈

- **前端**：原生 HTML/CSS/JS，Inter 字体，单体 SPA
- **后端**：Cloudflare Worker + D1 Database
- **行情**：Yahoo Finance（主）+ 腾讯 qt.gtimg.cn API（备），Worker 代理绕 CORS
- **部署**：Cloudflare Workers（免费套餐）
- **UI**：Robinhood 风格简洁设计

---

## 文件结构

| 文件 | 作用 |
|------|------|
| `public/index.html` | 主程序，6 页仪表盘全部逻辑 |
| `public/sw.js` | Service Worker，PWA 离线缓存 |
| `public/manifest.json` | PWA 配置（图标、名称、颜色） |
| `public/guide.html` | 使用文档网页版 |
| `public/使用文档.md` | 使用文档 Markdown 版 |
| `public/icon.png` | 网站图标 + PWA 图标 |
| `src/worker.js` | Worker 后端（价格代理 + 数据同步） |
| `schema.sql` | D1 数据库建表语句 |
| `wrangler.example.toml` | 部署配置模板（不含 Token） |
| `package.json` | 项目信息 + npm 脚本 |
| `package-lock.json` | 锁定依赖版本 |
| `.gitignore` | 排除敏感文件 |
| `readme.md` | 项目首页说明 |
| `maintenance.md` | 维护指南 + 代码结构速查 |
| `check-eval.js` | 语法检查工具 |

---

## 本地开发

```powershell
cd wealth-server
npx wrangler dev
```

## 部署

```powershell
npm install                        # 仅首次
cp wrangler.example.toml wrangler.toml   # 仅首次，填入 database_id 和 AUTH_TOKEN
npx wrangler d1 create wealth-db   # 仅首次
npx wrangler d1 execute wealth-db --file=schema.sql  # 仅首次
npx wrangler deploy                # 每次更新代码后执行
```

---

## 组合参数

| 标的 | 权重 |
|---|---|
| VGT | 50% |
| SMH | 30% |
| BTC | 20% |

SGOV 为独立备用金池，不参与组合占比计算。

---

## 使用文档

[guide.html](https://wealth-tracker.ssp2180481336.workers.dev/guide.html)
