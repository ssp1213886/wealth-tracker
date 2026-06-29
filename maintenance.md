# 📋 维护与部署指南

个人投资仪表盘（wealth-tracker）长期维护文档。方便自己随时改代码、部署、备份。

---

## 🗂 项目结构

```
wealth-server/
├── public/
│   ├── index.html          ← 主程序，6 页仪表盘全部逻辑
│   ├── sw.js               ← Service Worker，PWA 离线缓存
│   ├── manifest.json       ← PWA 配置（图标、名称、颜色）
│   ├── guide.html          ← 使用文档网页版
│   ├── 使用文档.md          ← 使用文档 Markdown 版
│   └── icon.png            ← 网站图标 + PWA 图标
├── src/
│   └── worker.js           ← Worker 后端（价格代理 + 数据同步）
├── schema.sql              ← D1 数据库建表语句
├── wrangler.example.toml   ← 部署配置模板（不含 Token）
├── package.json            ← 项目信息 + npm 脚本
├── package-lock.json       ← 锁定依赖版本
├── .gitignore              ← 排除敏感文件
├── readme.md               ← 项目首页说明
├── maintenance.md          ← 本文件：维护指南 + 代码结构速查
└── check-eval.js           ← 语法检查工具
```

> **核心文件**：`public/index.html` —— 整个网站是单个 HTML 文件，所有 UI 和逻辑都在里面。

---

## 🚀 部署（首次）

1. **克隆仓库**
```powershell
git clone https://github.com/ssp1213886/wealth-tracker.git
cd wealth-server
```

2. **安装依赖**
```powershell
npm install
```

3. **配置部署密钥**
```powershell
cp wrangler.example.toml wrangler.toml
# 编辑 wrangler.toml，填入：
#   - database_id（从 Cloudflare D1 控制台获取）
#   - AUTH_TOKEN（自己设定一个密码）
```

4. **创建数据库（仅首次）**
```powershell
npx wrangler d1 create wealth-db
npx wrangler d1 execute wealth-db --file=schema.sql
```

5. **部署上线**
```powershell
npx wrangler deploy
```

---

## 🔄 每次修改后的部署

改完代码后，两行命令：

```powershell
cd C:\Users\ssp\.openclaw-autoclaw\workspace\wealth-server
npx wrangler deploy
```

等 10 秒左右，刷新页面（Ctrl+Shift+R）即可看到更新。

---

## 💭 Vibe Coding 修改指南

### 怎么让 AI 帮你改代码

告诉 AI（比如我）你要改什么，我会直接编辑 `public/index.html` 然后自动部署。常用的改法：

**加一个功能：**
> "在仪表盘加一个显示本月收益的卡片"

**改 UI：**
> "把总资产字体调大一点"
> "按钮颜色换成蓝色"

**修 bug：**
> "删除交易记录后现金没更新"
> "同步功能用不了"

**数据相关：**
> "加一个新的 ETF 标的 ARKK"

### 改代码的原则

- **改动前**：AI 会先 `git commit` 当前版本，确保可以回退
- **改动后**：AI 会 `npx wrangler deploy` 自动部署
- **改错了**：`git revert` 回退，重新部署

### 自己手动改

用任何文本编辑器打开 `public/index.html`，改完保存，然后：
```powershell
npx wrangler deploy
```

---

## 💾 备份策略

### 自动备份

1. 侧栏勾选「自动备份」→ 每次操作自动下载 JSON 文件
2. 云端同步自动推送 → 数据存 Cloudflare D1

### 手动备份

1. 打开网站 → 侧栏「📤 导出」→ 下载 JSON 文件
2. 把 JSON 文件存到云盘（Google Drive / iCloud / 坚果云）
3. GitHub 仓库本身就是代码备份

### 备份频率建议

| 频率 | 内容 | 方式 |
|---|---|---|
| 每次交易后 | 数据 | 云端自动同步 |
| 每月 | 数据 | 手动导出 JSON 存网盘 |
| 每次改代码后 | 代码 | git push 到 GitHub |

---

## 🔧 常见问题

### 网站打不开

1. 检查 `https://wealth-tracker.ssp2180481336.workers.dev` 是否能访问
2. workers.dev 域名部分地区不稳定 → 绑定自定义域名（Cloudflare 免费）
3. 确认 Cloudflare 账号未被封

### 同步失败

1. 检查侧栏「☁️ 云端同步」面板的 URL 和 Token 是否正确
2. Token 与 `wrangler.toml` 中的 AUTH_TOKEN 必须一致
3. Token 与 `wrangler.toml` 中的 AUTH_TOKEN 必须一致

### 数据丢了

1. 从 JSON 备份文件恢复：侧栏「📥 导入」
2. 从云端恢复：先填好 Token → 点「⬇ 下载」
3. 两个都丢了 → 从零开始重新录入

### 想新建一个完全独立的副本

```powershell
# Fork GitHub 仓库 → Clone → 修改 wrangler.toml 中的 name → 重新部署
npx wrangler deploy
```

### GitHub 推送失败

```powershell
git pull --rebase
git push
```

---

---

## 📂 代码结构（index.html 内部）

`public/index.html` 内 JS 按功能区段用注释分隔，方便定位：

| 区段 | 内容 |
|------|------|
| 格式化工具 | `safeNum` `fmt$` `fmtFull` `fmtPct` |
| 投资组合计算 | `calcPortfolio` `updateSidebar` |
| 价格获取 & 缓存 | `fetchPrice` `pricePill` `refreshPrices` `updateMktStatus` |
| 持仓渲染 | `updatePortfolio` `updateDonutChart` |
| 数据持久化 | `loadState` `saveState` `loadCash` `saveTrades` |
| DCA 定投 | `updateDCA` `checkDCAStatus` |
| 活动日志 | `addActivity` `renderActivity` `renderLogHeatmap` |
| 数据页 | `updateDataPage` `updateTradeList` `updatePnlSummary` |
| 提款规划 | `updatePlanAges` `updateWithdrawal` |
| SGOV 池 | `updateSgovPage` |
| 主题 & UI | `toggleTheme` `setAccent` `switchTab` `updateMobStatusBar` |
| 交易操作 | `fillTradeForm` `doRebalance` |
| Toast 通知 | `showToast` |
| 云端同步 | `updateSidebarPrices` `autoPush` `autoPull` `syncPush` `syncPull` |
| CSV 导入 | `parseSchwabCSV` `doCSVImport` |
| 初始化 & 事件绑定 | `initAll` + 所有 `addEventListener` |

## 📦 技术栈速览

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | 原生 HTML/CSS/JS | 单个 SPA 文件，无框架 |
| 后端 | Cloudflare Worker | `src/worker.js` 处理同步请求 + Yahoo 价格代理 |
| 数据库 | Cloudflare D1 | SQLite 兼容，存交易和资金数据 |
| 行情 | Yahoo Finance（主）+ 腾讯 qt.gtimg.cn（备） | Worker 代理绕 CORS，前端无感 |
| 部署 | Wrangler CLI | `npx wrangler deploy` |
| 代码托管 | GitHub | `ssp1213886/wealth-tracker` |

**全部免费**，个人使用永远达不到限额。

---

## ⚠️ 注意事项

- `wrangler.toml` **绝对不能提交到 GitHub**（含 Token），已被 `.gitignore` 排除
- 多设备同时编辑会互相覆盖，等一边同步完再换设备
- JSON 导出文件含全部数据，**妥善保管**
- 浏览器清缓存会丢失本地数据，云端同步不受影响

---

最后更新：2026-06-29
