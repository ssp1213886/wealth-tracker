# My Portfolio — 个人投资仪表盘

VGT + SMH + BTC 定投组合的全功能追踪工具。持仓管理、蒙特卡洛模拟、提款规划、多设备云端同步、PWA 安装。

**线上地址**：`https://wealth-tracker.ssp2180481336.workers.dev`

---

## 功能

- **💼 持仓**：交易录入、加权均价、盈亏、再平衡、目标进度
- **📊 模拟**：GBM 蒙特卡洛、P50 中值曲线、历史回测、灵敏度分析
- **🗺 规划**：收入渐进加码、退出策略、提款模拟
- **☁️ 同步**：Cloudflare D1 云端存储，自动上传/下载，多设备同步
- **📁 CSV**：拖拽导入嘉信理财交易记录
- **📱 PWA**：可添加到手机主屏幕，离线访问

---

## 项目结构

```
wealth-server/
├── public/
│   ├── index.html          # 主应用（dashboard，SPA 单文件）
│   ├── guide.html          # 使用文档（独立页面）
│   ├── 使用文档.md          # 使用文档（Markdown 版）
│   ├── manifest.json       # PWA 配置（图标、名称、主题色）
│   ├── icon.svg            # PWA 图标（SVG，默认版）
│   └── icon.png            # PWA 图标（PNG，自定义版）
├── src/
│   └── worker.js           # Cloudflare Worker 后端 API
├── schema.sql              # D1 数据库建表语句
├── wrangler.example.toml   # 部署配置模板（Token 占位符）
├── package.json            # Node 依赖（wrangler）
├── package-lock.json       # 依赖锁定
└── .gitignore              # 排除 node_modules / wrangler.toml / 构建产物
```

### 文件说明

| 文件 | 用途 |
|---|---|
| `public/index.html` | 仪表盘唯一权威源。包含全部前端逻辑：三个 Tab、侧边栏、云端同步、CSV 导入、蒙特卡洛引擎 |
| `public/guide.html` | 使用文档网页版，手机可读 |
| `public/manifest.json` | PWA 配置。定义了应用名、图标、启动方式 |
| `public/icon.png` | PWA 主屏幕图标（192×192） |
| `src/worker.js` | Cloudflare Worker。处理 REST API：GET/POST/DELETE 数据，CORS，X-Auth-Token 鉴权 |
| `schema.sql` | D1 数据库建表 DDL。`portfolio_data` 表存用户数据 |
| `wrangler.example.toml` | 部署配置模板。复刻时复制为 `wrangler.toml`，填入自己的 AUTH_TOKEN |
| `.gitignore` | 防止 `wrangler.toml`（含真实 Token）和 `node_modules/` 被提交 |

> ⚠️ `wrangler.toml` 不在仓库中，它包含 AUTH_TOKEN。部署时从 `wrangler.example.toml` 复制并填入真实值。

---

## 技术栈

- **前端**：原生 HTML/CSS/JS，无框架，单体 SPA
- **后端**：Cloudflare Worker + D1 Database
- **行情**：腾讯 qt.gtimg.cn API
- **部署**：Cloudflare Workers（免费套餐）
- **模拟**：GBM 蒙特卡洛（几何布朗运动）

---

## 本地开发

```powershell
cd wealth-server
npx wrangler dev
```

## 部署

```powershell
# 1. 创建 wrangler.toml（仅首次）
copy wrangler.example.toml wrangler.toml
# 编辑 wrangler.toml，填入 AUTH_TOKEN

# 2. 创建 D1 数据库（仅首次）
npx wrangler d1 create portfolio-db
# 将返回的 database_id 填入 wrangler.toml

# 3. 初始化表结构
npx wrangler d1 execute portfolio-db --file=schema.sql

# 4. 部署
npx wrangler deploy
```

---

## 组合参数

| 标的 | 权重 | 预期年化 |
|---|---|---|
| VGT | 50% | 12% |
| SMH | 30% | 14% |
| BTC | 20% | 18% |

加权中枢年化：13.8%，波动率：~25%

---

## 使用文档

[guide.html](https://wealth-tracker.ssp2180481336.workers.dev/guide.html) — 含完整功能说明、CSV 导入格式、注意事项
