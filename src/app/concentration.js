import { escapeHtml } from './render.js';

function pct(value) {
  const n = Number(value);
  return n > 0 ? n.toFixed(1) + '%' : '—';
}

function sumShares(rows, count) {
  return Number(rows.slice(0, count).reduce(function (sum, row) { return sum + (Number(row.share) || 0); }, 0).toFixed(1));
}

function concentrationLabel(top10, techShare) {
  if (!(top10 > 0)) return '—';
  if (top10 >= 70 || Number(techShare) >= 80) return '高度集中';
  if (top10 >= 50 || Number(techShare) >= 65) return '偏集中';
  return '相对分散';
}

/** 从现有底层敞口数据生成集中度与重叠摘要，不新增任何行情请求。 */
export function concentrationSummary(input) {
  const source = input || {};
  const rows = (Array.isArray(source.rows) ? source.rows : [])
    .filter(function (row) { return Number(row && row.share) > 0; })
    .sort(function (a, b) { return Number(b.share) - Number(a.share); });
  const etfRest = Array.isArray(source.etfRest) ? source.etfRest : [];
  const base = Number(source.base) || 0;
  const valueByEtf = source.valueByEtf || {};
  const allShares = rows.concat(etfRest.map(function (row) { return { share: row.share, label: row.label }; }))
    .filter(function (row) { return Number(row.share) > 0; });
  const hhi = Math.round(allShares.reduce(function (sum, row) {
    const fraction = (Number(row.share) || 0) / 100;
    return sum + fraction * fraction * 10000;
  }, 0));
  const overlaps = rows
    .filter(function (row) { return Array.isArray(row.parts) && row.parts.length > 1; })
    .sort(function (a, b) { return Number(b.share) - Number(a.share); });
  const overlapShare = Number(overlaps.reduce(function (sum, row) { return sum + (Number(row.share) || 0); }, 0).toFixed(1));
  const techValue = (Number(valueByEtf.VGT) || 0) + (Number(valueByEtf.SMH) || 0);
  const top10 = sumShares(rows, 10);
  const techShare = base > 0 ? Number((techValue / base * 100).toFixed(1)) : null;
  return {
    max: rows[0] || null,
    top3: sumShares(rows, 3),
    top5: sumShares(rows, 5),
    top10: top10,
    hhi: hhi,
    hhiLabel: concentrationLabel(top10, techShare),
    overlapShare: overlapShare,
    overlapCount: overlaps.length,
    overlaps: overlaps.slice(0, 4),
    techShare: techShare,
    base: base,
  };
}

export function concentrationHtml(summary) {
  const s = summary || {};
  const max = s.max;
  const overlap = (s.overlaps || []).map(function (row) {
    return '<div class="conc-overlap-row"><b>' + escapeHtml(row.sym || row.name || '') + '</b>' +
      '<span>' + pct(row.share) + '</span><small>' + escapeHtml((row.parts || []).join(' + ')) + '</small></div>';
  }).join('');
  return '<div class="concentration-summary">' +
    '<div class="conc-head"><strong>集中度摘要</strong><span class="conc-badge">' + escapeHtml(s.hhiLabel || '—') + '</span></div>' +
    '<div class="conc-grid">' +
      '<div><small>最大底层资产</small><b>' + escapeHtml(max ? (max.sym || max.name) + ' ' + pct(max.share) : '—') + '</b></div>' +
      '<div><small>前 3 大</small><b>' + pct(s.top3) + '</b></div>' +
      '<div><small>前 5 大</small><b>' + pct(s.top5) + '</b></div>' +
      '<div><small>前 10 大</small><b>' + pct(s.top10) + '</b></div>' +
      '<div><small>重叠成分股</small><b>' + pct(s.overlapShare) + '</b></div>' +
      '<div><small>HHI</small><b>' + (Number(s.hhi) || 0) + '</b></div>' +
    '</div>' +
    (overlap ? '<div class="conc-overlaps"><div class="conc-sub">主要重叠 · ' + (Number(s.overlapCount) || 0) + ' 只</div>' + overlap + '</div>' : '') +
    (s.techShare != null ? '<div class="conc-foot">VGT + SMH 占持仓市值 ' + pct(s.techShare) + '</div>' : '') +
  '</div>';
}
