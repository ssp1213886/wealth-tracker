// ETF 前十大构成股的静态兜底榜单。
// 运行时优先解析 Yahoo 的 holdings 页面（VGT 可用），解析失败或该基金无内嵌数据（SMH）时用这里的数据，
// 保证卡片永远有内容。每季度手工核对一次，并更新 asOf。
// 来源：VGT ← finance.yahoo.com/quote/VGT/holdings/（2026-09-28 抓取）；
//       SMH ← vaneck.com SMH holdings 页（as of 09/24/2026，官方）。

export const STATIC_HOLDINGS = {
  VGT: {
    symbol: 'VGT',
    name: 'Vanguard Information Technology ETF',
    asOf: '2026-09-28',
    source: 'static',
    list: [
      { sym: 'NVDA', name: 'NVIDIA Corp', weight: 17.74 },
      { sym: 'AAPL', name: 'Apple Inc', weight: 15.8 },
      { sym: 'MSFT', name: 'Microsoft Corp', weight: 11.52 },
      { sym: 'AVGO', name: 'Broadcom Inc', weight: 4.52 },
      { sym: 'MU', name: 'Micron Technology Inc', weight: 4.18 },
      { sym: 'AMD', name: 'Advanced Micro Devices Inc', weight: 2.95 },
      { sym: 'CSCO', name: 'Cisco Systems Inc', weight: 1.71 },
      { sym: 'PLTR', name: 'Palantir Technologies Inc', weight: 1.61 },
      { sym: 'INTC', name: 'Intel Corp', weight: 1.54 },
      { sym: 'LRCX', name: 'Lam Research Corp', weight: 1.49 },
    ],
  },
  SMH: {
    symbol: 'SMH',
    name: 'VanEck Semiconductor ETF',
    asOf: '2026-09-24',
    source: 'static',
    list: [
      { sym: 'NVDA', name: 'Nvidia Corp', weight: 19.28 },
      { sym: 'TSM', name: 'Taiwan Semiconductor Manufacturing', weight: 9.26 },
      { sym: 'AMD', name: 'Advanced Micro Devices Inc', weight: 5.8 },
      { sym: 'AVGO', name: 'Broadcom Inc', weight: 5.25 },
      { sym: 'INTC', name: 'Intel Corp', weight: 5.17 },
      { sym: 'MU', name: 'Micron Technology Inc', weight: 5.05 },
      { sym: 'SKHYV', name: 'SK Hynix Inc', weight: 4.5 },
      { sym: 'TXN', name: 'Texas Instruments Inc', weight: 4.46 },
      { sym: 'MRVL', name: 'Marvell Technology Inc', weight: 4.44 },
      { sym: 'KLAC', name: 'KLA Corp', weight: 4.41 },
    ],
  },
};

export const HOLDINGS_SYMBOLS = Object.keys(STATIC_HOLDINGS);
