## 盘前盘后逻辑审计

### 当前 Worker 逻辑

```
price = indicators.lastClose (盘前/盘后) or regularMarketPrice (盘中)
prevClose = regularMarketPrice  ← BUG!
```

### 三种时段测试

| 时段 | price | prevClose=regularMarketPrice | 结果 |
|------|-------|------|------|
| 🕐 盘前 | indicators close (115.85) | 上次收盘价 (113.86) ✅ | 正确 |
| 🕐 盘中 | regularMarketPrice (实时) | **同一个实时价** ❌ | 涨跌永远=0！ |
| 🕐 盘后 | indicators close (盘后价) | 当天收盘价 ✅ | 正确 |

### 根因
盘中时段 `regularMarketPrice` 是实时价格，用它当 `prevClose` 会让涨降永远为 0。
盘前时段它恰好等于上次收盘价，歪打正着对了。
