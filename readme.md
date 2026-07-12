# Wealth Tracker · 个人投资仪表盘

VGT + SMH + BTC 永久核心仓 + Covered Call 增强策略，Cloudflare Worker + D1 云端同步的 PWA 投资追踪工具。

**线上地址**：[https://wealth-tracker.ssp2180481336.workers.dev](https://wealth-tracker.ssp2180481336.workers.dev)

---

## 投资策略：永久核心仓 + Covered Call

核心思想：永远持有 VGT/SMH/BTC 作为财富发动机，用部分仓位卖 CALL 获取额外现金流，权利金继续买入核心资产，让期权成为复利加速器，而不是替代投资。

- **核心仓（永不动）**：VGT / SMH / BTC 按月定投，比例可调
- **Covered Call**：持有正股，卖出虚值 CALL，收取权利金
- **权利金复投**：收取的权利金按核心仓比例继续买入 VGT/SMH/BTC
- **被动行权 T+1 买回**：若 CALL 被行权，T+1 手动买回正股保持仓位，不提前平仓
- **铁律**：不卖正股、永不满仓（始终保留至少 1 张不卖）、不提前平仓

---

## 页面结构

| 页面 | 功能 |
|------|------|
| 仪表盘 | 总资产指标、定投进度、目标进度条（shimmer）、高点回撤、仓位盈亏、持仓分布环形图、CC 收入卡片、期权持仓摘要 |
| 操作台 | 股票买卖录入（VGT/SMH/BTC/SGOV）、年度再平衡（换仓/注资，仅12/31解锁） |
| 期权 | 持仓指标、OTM 行权价参考（可调百分比+localStorage）、期权状态（ITM 蓝色标签+铁律提示）、记录 CALL/PUT、CC 收入、持仓清单 |
| 数据 | 现金管理（入金/出金/修正）、持仓明细（含张数列+列排序）、交易历史（筛选/排序）、资金流水（权利金蓝色独立标注） |
| 日志 | 操作日志（热力图）、纪律打卡（连续定投+热力图）、投资规划（收入渐进加码/退出策略/提款模拟） |

### 移动端底部导航
5 键：仪表盘 → 操作台 → 期权 → 数据 → 日志

---

## 侧边栏

- 总资产 + 现金/持仓分解 + 持仓环形图
- 期权持仓摘要（标的/类型/行权价/张数/到期日）
- 实时价格（VGT/SMH/BTC/SGOV，来源标注）
- 云端同步（D1 数据库，支持推/拉，状态指示）
- 投资参数（月度定投总额、路线图起始日期+年龄、财务目标、仓位分配滑块）
- 5 种配色方案（森林/海洋/暖阳/梅紫/极简）
- 自动备份开关 + 上次备份时间
- JSON 导出/导入 + Schwab CSV 导入
- 暗色/亮色模式切换

---

## 主要功能

- OTM 行权价参考：VGT/SMH 按 +/- 调整百分比计算建议行权价，存 localStorage 记忆
- 期权 CALL-only 策略（虽保留 PUT 类型选项供灵活使用，策略建议仅卖 CALL）：被动行权 T+1 开盘市价买回，亏损远小于提前平仓
- Covered Call 仪表盘卡片：本月 CC 收入 + 张数统计，权利金复投核心仓
- 资金流水权利金独立显示：权利金以蓝色标注，入金/出金独立着色
- 账户现金汇总：入金合计排除权利金（权利金不统计为入金，仅影响现金余额）
- 持仓清单含张数列，支持列排序
- 现金修正：手动校准现金余额，自动记录流水
- 纪律打卡：连续定投月份计数器 + 操作日志热力图
- 投资规划：收入渐进加码（4阶段）、47岁退出策略（切换防守组合）、提款模拟器
- 暗色/亮色模式 + 5 种配色（森林/海洋/暖阳/梅紫/极简）
- 年度再平衡：换仓/注资模式，仅12月31日解锁执行
- PWA 可安装（manifest.json + sw.js）
- Toast 提示美化：毛玻璃效果 + 弹性弹入动画 + 撤销类支持点击撤销
- 表格表头 sticky 固定：持仓明细、交易历史表头滚动时吸顶
- 按钮/卡片/微交互 UI 统一：hover 浮起、点击缩放、统一过渡动画
- Cloudflare D1 云端同步（期权交易纳入同步）
- Yahoo Finance 实时行情（Worker 代理绕 CORS）
- Schwab CSV 拖拽导入
- JSON 导出/导入

---

## 技术栈

- 前端：原生 HTML/CSS/JS，单文件 SPA，Inter 字体
- 后端：Cloudflare Worker + D1 Database
- 行情：Yahoo Finance（通过 Worker 代理）
- 部署：Cloudflare Workers

---

## 本地开发

```bash
cd wealth-server
npm install
npx wrangler dev
```

## 部署

```bash
npm install
npx wrangler deploy
```

## 文件结构

| 文件 | 作用 |
|------|------|
| `public/index.html` | 主程序，单文件 SPA（全部 UI + 逻辑，~162KB） |
| `public/guide.html` | 使用文档 |
| `public/sw.js` | Service Worker（network-first） |
| `public/manifest.json` | PWA 配置 |
| `public/icon.png` | 应用图标 |
| `src/worker.js` | Worker 后端（价格代理 + D1 数据同步 + 频率限制） |
| `schema.sql` | D1 建表语句 |
| `.wrangler/tmp/` | Wrangler 本地开发临时文件（自动生成，不纳入版本控制） |
| `maintenance.md` | 维护指南 + 代码结构速查 |

---

## 数据备份

项目支持多种备份与恢复方式：

- **自动备份**：侧边栏开启「自动备份」开关后，每次数据保存时自动下载 JSON 文件到本地，并显示上次备份时间
- **JSON 手动导出**：侧边栏导出按钮，一键下载含交易记录、资金流水、投资参数、期权的完整 JSON
- **JSON 手动导入**：侧边栏导入按钮，选择 JSON 文件恢复全部数据
- **Schwab CSV 导入**：支持拖拽或点击导入 Schwab 交易历史 CSV 文件
- **云端同步**：D1 数据库推/拉，多设备数据同步
- **Git 代码备份**：`git add -A && git commit -m "backup" && git push`

首次使用时若检测到无数据，会自动提示用户导入备份或云端下载。

## License

MIT