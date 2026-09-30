// 首页/侧栏的持仓视图层：指标卡、盈亏明细、持仓表、目标进度、回撤面板、行情胶囊。
// v250 从 index.js 的 updatePortfolio 里抽出（行为完全一致）：
//   这里只负责"把算好的数字写进 DOM"，计算仍全部在 index.js（computeHoldings / portfolioTotals / dailyChange / goalProgress）。

import { fmtFull, fmtPnLFull } from './util.js';
import { escapeHtml, emptyStateHTML } from './render.js';

/** 大额金额缩写（$1.23M / $456K）——index.js 的 fmt$，其余地方也在用，这里用注入。 */
let deps = {
  getAssetColor: () => '',
  pricePill: () => '',
  fmtMoney: (n) => String(n),
};

export function configurePortfolioView(next) {
  const d = next || {};
  if (typeof d.getAssetColor === 'function') deps.getAssetColor = d.getAssetColor;
  if (typeof d.pricePill === 'function') deps.pricePill = d.pricePill;
  if (typeof d.fmtMoney === 'function') deps.fmtMoney = d.fmtMoney;
}

/** 盈亏百分比括号写法：+12.3% / -4.5%（纯函数，v250 从 index.js 搬来） */
export function fmtPnLPctParen(n){if(!isFinite(n)||isNaN(n))return'';return'('+(n>=0?'+':'')+(n*100).toFixed(1)+'%)'}

/** 顶部三张指标卡：总市值 / 总资产 / 现金占比。 */
export function renderMetricsTop(doc, m) {
  // 行情还没到：给依赖现价的数字加骨架微光（CSS 里的 .is-skeleton），避免满屏 "-"
  ['hmValue', 'hmUnreal', 'hmPnL'].forEach(function (id) {
    const el = doc.getElementById(id);
    if (el && el.classList && el.classList.toggle) el.classList.toggle('is-skeleton', !m.hasPriced);
  });
  doc.getElementById('hmValue').textContent=m.hasPriced?fmtFull(m.totalValue):'-';var totalAssetValue=m.totals.totalAssets,ht=doc.getElementById('hmTotal');if(ht)ht.textContent=fmtFull(totalAssetValue);var hcp=doc.getElementById('hmCashPct');if(hcp)hcp.textContent=cashPctText(m.totals.cashPct);
}

/**
 * 现金占比的显示文案：null（总资产 ≤ 0，占比无意义）→「—」。
 * 与 `portfolio.js` 的 `cashPctOf` 配对：口径一份、文案一份，两处调用点共用（见 cashPctOf 的注释）。
 */
export function cashPctText(cashPct) {
  return cashPct == null ? '—' : cashPct.toFixed(2) + '%';
}

/** 今日涨跌、总盈亏、以及"浮动/已实现/权利金"三个明细徽章。 */
export function renderMetricsPnl(doc, m) {
var hu=doc.getElementById('hmUnreal');if(hu){hu.textContent=m.hasPriced?fmtPnLFull(m.dailyChg):'-';hu.className='m-val '+(m.hasPriced?(m.dailyChg>=0?'pnl-pos':'pnl-neg'):'')}
  var hup=doc.getElementById('hmUnrealPct');if(hup){if(m.hasPriced&&m.dailyPct!=null){var s2=m.dailyPct>=0?'+':'';hup.innerHTML='<span style=color:'+(m.dailyPct>=0?'var(--accent)':'var(--red)')+';font-weight:550>'+s2+m.dailyPct.toFixed(2)+'% 今日</span>'}else{hup.textContent='按实时价估算'}}
  var hp=doc.getElementById('hmPnL');if(hp){hp.textContent=m.hasPriced&&m.totalPnL!=null?fmtPnLFull(m.totalPnL):'-';hp.className='m-val '+(m.hasPriced&&m.totalPnL!=null?(m.totalPnL>=0?'pnl-pos':'pnl-neg'):'')}
  var hpp=doc.getElementById('hmPnLPct');if(hpp){var s='';if(m.hasPriced&&m.totalPct!=null){s+=fmtPnLPctParen(m.totalPct)+'<br>'}else if(m.unpriced.length>0){s+='需设价:'+m.unpriced.join(',')+'<br>'}var uc=m.totalPnLUnreal||0,rc=m.totalRealized;s+='<span style="display:inline-block;padding:1px 6px;border-radius:8px;font-size:11.5px;margin:2px 3px 0 0;background:'+(uc>=0?'var(--accent-l)':'rgba(229,57,53,.1)')+';color:'+(uc>=0?'var(--accent-d)':'#b53a2a')+';">浮动 '+fmtPnLFull(uc)+'</span>';s+='<span style="display:inline-block;padding:1px 6px;border-radius:8px;font-size:11.5px;margin-top:2px;background:'+(rc>=0?'rgba(22,153,74,.1)':'rgba(229,57,53,.08)')+';color:'+(rc>=0?'var(--accent-d)':'#b53a2a')+';">已实现 '+fmtPnLFull(rc)+'</span>';s+='<span style="display:inline-block;padding:1px 6px;border-radius:8px;font-size:11.5px;margin-top:2px;background:'+(m.realizedOptionPremium>=0?'var(--accent-l)':'rgba(229,57,53,.08)')+';color:'+(m.realizedOptionPremium>=0?'var(--accent-d)':'#b53a2a')+';">权利金 '+fmtPnLFull(m.realizedOptionPremium)+'</span>';hpp.innerHTML=s;}
}

/** 持仓表：每行的资产色、股数、均价、市值、盈亏。 */
export function renderHoldingsBody(doc, rows) {
  var hb=doc.getElementById('holdBody');
  if(hb)hb.innerHTML=rows.length?rows.map(function(r){return'<tr style="--row-accent:'+deps.getAssetColor(r.sym)+'"><td data-cell="sym">'+r.sym+'</td><td data-cell="shares">'+Math.abs(r.shares).toFixed(2)+'</td><td data-cell="avg">$'+r.avgCost.toFixed(2)+'</td><td data-cell="value">'+(r.priced?fmtFull(r.value):'<span style="color:orange;">-</span>')+'</td><td data-cell="pnl" class="'+(r.priced&&r.unrealPnL!=null?(r.unrealPnL>=0?'pnl-pos':'pnl-neg'):'')+'">'+(r.priced&&r.unrealPnL!=null?fmtPnLFull(r.unrealPnL):'-')+'</td><td data-cell="pct" class="'+(r.priced&&r.unrealPnL!=null?(r.unrealPnL>=0?'pnl-pos':'pnl-neg'):'')+'">'+(r.priced&&r.pnlPct!=null?((r.pnlPct>=0?'+':'')+(r.pnlPct*100).toFixed(1)+'%'):'-')+'</td><td data-cell="actions"><button class="trade-del" data-hold="'+r.sym+'" title="清仓" aria-label="清仓该标的">×</button></td></tr>'}).join(''):'<tr><td colspan="7">'+emptyStateHTML({title:'暂无持仓',hint:'录入第一笔交易后会显示在这里',compact:true,icon:'<svg viewBox="0 0 24 24"><path d="M4 19V6"/><path d="M4 19h16"/><path d="m8 15 3-3 3 3 4-6"/></svg>'})+'</td></tr>';
}

/** 目标进度条 + 差额 + 目标文案。 */
export function renderGoalProgress(doc, g) {
  doc.getElementById('prBar').style.width=g.pctVal+'%';doc.getElementById('prPct').textContent=g.pctVal.toFixed(1)+'%';doc.getElementById('prGap').textContent=fmtFull(g.gap);doc.getElementById('prGap').style.color=g.gap>0?'var(--red)':'var(--accent)';doc.getElementById('prCostInline').textContent=g.hasPriced?fmtFull(g.totalAssets):fmtFull(g.totalAssets);var tgt=doc.getElementById('targetName');if(tgt)tgt.textContent=deps.fmtMoney(g.target);var tl2=doc.getElementById('targetLabel');if(tl2)tl2.textContent=deps.fmtMoney(g.target);var pti=doc.getElementById('prTargetInline');if(pti)pti.textContent=deps.fmtMoney(g.target);
}

/** 距 52 周高点回撤面板（没有行情时显示空态）。 */
export function renderDrawdownPanel(doc, d) {
  var tc=doc.getElementById('hmDrawdown'),ts=doc.getElementById('hmDrawdownSub'),tw=doc.getElementById('hmDrawdownWorst');
  if(d.lines.length>0){tc.className='drawdown-visual';var worst=d.lines.reduce(function(a,b){return a.dd>b.dd?a:b});tc.innerHTML=d.lines.map(function(d){var currentPct=Math.max(2,Math.min(100,100-d.dd)),gapPct=Math.max(0,Math.min(98,d.dd)),barColor=d.dd>=20?'var(--red)':d.dd>=10?'var(--orange)':'var(--accent)';return '<div class="drawdown-row" style="--drawdown-color:'+barColor+'"><span class="drawdown-symbol"><strong>'+escapeHtml(d.sym)+'</strong><small>$'+d.price.toFixed(2)+' / $'+d.peak.toFixed(2)+'</small></span><div class="drawdown-track" aria-label="'+escapeHtml(d.sym)+' 距离52周高点 '+d.dd.toFixed(1)+'%"><i class="drawdown-gap" style="width:'+gapPct+'%"></i><i class="drawdown-marker" style="left:'+currentPct+'%"></i></div><span class="drawdown-value">-'+d.dd.toFixed(1)+'%</span></div>'}).join('');if(tw)tw.textContent='最大 -'+worst.dd.toFixed(1)+'%';if(ts)ts.style.display='flex'}else{tc.className='drawdown-empty';tc.textContent='添加价格后显示';if(tw)tw.textContent='最大 --';if(ts)ts.style.display='none'}
}

/** 首页三支标的的行情胶囊与更新时间。 */
export function renderPricePills(doc, p) {
  doc.getElementById('hmPricesCompact').setAttribute('aria-busy','false');doc.getElementById('hmPricesCompact').innerHTML=p.symbols.map(function(sym){return p.prices[sym]?deps.pricePill(sym,p.prices[sym],p.changes[sym],p.sources[sym]||''):'<span class="price-pill" data-sym="'+sym+'" style="cursor:pointer"><span class="pp-sym">'+sym+'</span><span style="color:var(--orange)">--</span></span>'}).join('');
  var ct=doc.getElementById('hmPriceTime');if(ct&&!ct.textContent)ct.textContent='更新 '+new Date().toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'});
}
