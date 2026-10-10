// 核心仓配置（v374）：把"哪几只标的、各占多少、哪几只卖 CALL、节奏/OTM 怎么定"从代码里拿出来，
// 变成一份可以在「设置 → 投资参数」里改的配置（存在 state.core，跟着 state 一起同步）。
//
// 纯逻辑、无 DOM、无存储：默认值、归一化、校验、派生（标的清单 / 期权清单 / 比例 / 底层资产 / OTM）
// 全在这里，index.js 只负责"读配置 → 重渲界面"。这样它既能离线单测，也能被 Worker 复用（Phase B）。

/** 默认核心仓：VGT + SMH + IBIT（与 v373 的策略一致）。 */
export const CORE_DEFAULTS = [
  { sym: 'VGT', target: 0.5, asset: '', opt: { on: false } },
  { sym: 'SMH', target: 0.3, asset: '', opt: { on: true, rule: 'monthly3', otm: 7 } },
  { sym: 'IBIT', target: 0.2, asset: '比特币', opt: { on: true, rule: 'everyNw', weeks: 3, anchor: '2026-10-30', otm: 10 } },
];

export const OPT_RULES = ['monthly3', 'everyNw'];
export const MAX_CORE_SYMS = 6;      // 上限与 Worker 的行情白名单放开幅度配套
export const MAX_OPTION_SYMS = 3;
export const OPT_WEEKS_MIN = 1;
export const OPT_WEEKS_MAX = 6;
export const OTM_MIN = 1;
export const OTM_MAX = 30;

const SYM_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export function validSym(value) {
  return SYM_RE.test(String(value || '').trim().toUpperCase());
}

/** 'YYYY-MM-DD' 是不是周五（期权到期日只能是周五）。 */
export function isFriday(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(t);
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) && d.getUTCDay() === 5;
}

/** 从某天（含当天）起，往后 count 个周五 —— 设置页给"锚点"下拉用。 */
export function nextFridays(fromIso, count) {
  const out = [];
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fromIso || '').trim());
  const base = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : Date.now();
  let t = base;
  for (let i = 0; i < 60 && out.length < (Number(count) || 8); i += 1) {
    const d = new Date(t);
    if (d.getUTCDay() === 5) out.push(d.toISOString().slice(0, 10));
    t += 86400000;
  }
  return out;
}

function clampNum(value, min, max, fallback) {
  const n = Number(value);
  if (!isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeOpt(raw, fallback) {
  const o = (raw && typeof raw === 'object') ? raw : {};
  const base = fallback || { on: false };
  /* ⚠️ 显式的 false 必须能覆盖默认值 —— 否则"默认开着卖 CALL 的标的（如 IBIT）根本关不掉"：
     第一版写成 `!!o.on || !!o.enabled || !!base.on`，用户取消勾选后又被默认的 on=true 顶回来。 */
  const on = (typeof o.on === 'boolean') ? o.on
    : (typeof o.enabled === 'boolean') ? o.enabled
      : !!base.on;
  if (!on) return { on: false };
  const rule = OPT_RULES.indexOf(o.rule) >= 0 ? o.rule : (OPT_RULES.indexOf(base.rule) >= 0 ? base.rule : 'monthly3');
  const out = {
    on: true,
    rule: rule,
    otm: clampNum(o.otm != null ? o.otm : base.otm, OTM_MIN, OTM_MAX, 7),
  };
  if (rule === 'everyNw') {
    out.weeks = Math.round(clampNum(o.weeks != null ? o.weeks : base.weeks, OPT_WEEKS_MIN, OPT_WEEKS_MAX, 3));
    const anchor = String(o.anchor || base.anchor || '').slice(0, 10);
    if (isFriday(anchor)) out.anchor = anchor;
  }
  return out;
}

/**
 * 归一化核心仓配置。传 legacy（旧的 state.vgt/smh/btc + otmSettings）时，用它兜出默认值/比例，
 * 这样 v3→v4 迁移与"老数据首次读取"是同一套逻辑。
 */
export function normalizeCore(raw, legacy) {
  const old = legacy && typeof legacy === 'object' ? legacy : {};
  const oldOpt = old.otm && typeof old.otm === 'object' ? old.otm : {};
  const fallbackFor = function (sym) {
    if (sym === 'VGT') return { target: old.vgt != null ? old.vgt : 0.5, asset: '', opt: { on: false, otm: oldOpt.vgt != null ? oldOpt.vgt : 7 } };
    if (sym === 'SMH') return { target: old.smh != null ? old.smh : 0.3, asset: '', opt: { on: true, rule: 'monthly3', otm: oldOpt.smh != null ? oldOpt.smh : 6 } };
    return { target: old.btc != null ? old.btc : 0.2, asset: '比特币', opt: { on: true, rule: 'everyNw', weeks: 3, anchor: fallbackAnchors()[2], otm: oldOpt.ibit != null ? oldOpt.ibit : 10 } };
  };

  const list = Array.isArray(raw) ? raw : [];
  if (!list.length) {
    /* 没有配置过 → 默认三只 + **旧配置优先**（用户改过的比例/OTM 不能丢，CORE_DEFAULTS 只补缺） */
    return CORE_DEFAULTS.map(function (def) {
      const fb = fallbackFor(def.sym);
      return {
        sym: def.sym,
        target: clampNum(fb.target, 0, 1, def.target),
        asset: def.asset,
        opt: normalizeOpt(fb.opt, def.opt),
      };
    });
  }

  const used = {};
  const out = [];
  list.forEach(function (item) {
    if (!item || typeof item !== 'object') return;
    const sym = String(item.sym || '').trim().toUpperCase();
    if (!validSym(sym) || used[sym]) return;
    used[sym] = 1;
    const fb = fallbackFor(sym);
    out.push({
      sym: sym,
      target: clampNum(item.target != null ? item.target : fb.target, 0, 1, 0),
      asset: String(item.asset == null ? fb.asset : item.asset).slice(0, 12),
      opt: normalizeOpt(item.opt, fb.opt),
    });
  });
  if (!out.length) return normalizeCore(null, old);
  return out.slice(0, MAX_CORE_SYMS);
}

/** 迁移用：从今天起的第 3 个周五（默认锚点，与 SMH 的 2026-10-30 对齐） */
function fallbackAnchors() {
  return nextFridays(new Date().toISOString().slice(0, 10), 6);
}

/** 派生的标的名（顺序即配置顺序）。 */
export function coreSymbols(core) {
  return normalizeCore(core).map(function (x) { return x.sym; });
}

/** 参与期权的标的名。 */
export function optionSymbols(core) {
  return normalizeCore(core).filter(function (x) { return x.opt && x.opt.on; }).map(function (x) { return x.sym; });
}

export function entryOf(core, sym) {
  const s = String(sym || '').toUpperCase();
  return normalizeCore(core).find(function (x) { return x.sym === s; }) || null;
}

export function targetOf(core, sym) {
  const e = entryOf(core, sym);
  return e ? e.target : 0;
}

export function assetOf(core, sym) {
  const e = entryOf(core, sym);
  return e && e.asset ? e.asset : String(sym || '').toUpperCase();
}

export function otmOf(core, sym, fallback) {
  const e = entryOf(core, sym);
  if (e && e.opt && e.opt.on && e.opt.otm) return e.opt.otm;
  return fallback != null ? fallback : 7;
}

/** 期权节奏配置 → cc-schedule 认的老形状（{rule, weeks, anchor}），没配就返回 null。 */
export function optScheduleOf(core, sym) {
  const e = entryOf(core, sym);
  if (!e || !e.opt || !e.opt.on) return null;
  const out = { rule: e.opt.rule };
  if (e.opt.rule === 'everyNw') { out.weeks = e.opt.weeks; out.anchor = e.opt.anchor; }
  return out;
}

/** 校验（设置页保存前用）。返回 { ok, errors, warnings }。 */ 
/* —— 设置页的编辑器 <-> 配置（纯函数，便于单测）——
   编辑器里比例用"百分数"（50 比 0.5 好输入），保存时再除以 100。 */
export function draftFromCore(core) {
  return normalizeCore(core).map(function (x) {
    const o = x.opt || {};
    return {
      sym: x.sym,
      target: Math.round(x.target * 1000) / 10,
      asset: x.asset || '',
      on: !!o.on,
      rule: o.on ? o.rule : 'monthly3',
      weeks: o.weeks || 3,
      anchor: o.anchor || '',
      otm: o.otm || 7,
    };
  });
}

export function coreFromDraft(rows) {
  return (Array.isArray(rows) ? rows : []).map(function (r) {
    const row = r || {};
    const on = !!row.on;
    const opt = on ? {
      on: true,
      rule: OPT_RULES.indexOf(row.rule) >= 0 ? row.rule : 'monthly3',
      otm: Number(row.otm),
      weeks: Number(row.weeks),
      anchor: row.anchor,
    } : { on: false };
    return {
      sym: String(row.sym || '').trim().toUpperCase(),
      target: (Number(row.target) || 0) / 100,
      asset: String(row.asset == null ? '' : row.asset).trim(),
      opt: opt,
    };
  });
}

export function validateCore(core) {
  const errors = [];
  const warnings = [];
  const list = Array.isArray(core) ? core : [];
  if (!list.length) errors.push('至少要保留 1 只标的');
  if (list.length > MAX_CORE_SYMS) errors.push('最多 ' + MAX_CORE_SYMS + ' 只标的');
  const seen = {};
  let sum = 0;
  let optCount = 0;
  list.forEach(function (item) {
    const sym = String((item && item.sym) || '').trim().toUpperCase();
    if (!validSym(sym)) { errors.push('代码不合法：' + (sym || '（空）')); return; }
    if (seen[sym]) { errors.push('代码重复：' + sym); return; }
    seen[sym] = 1;
    const t = Number(item && item.target);
    if (!isFinite(t) || t < 0) errors.push(sym + ' 的目标比例不合法');
    else sum += t;
    const opt = item && item.opt;
    if (opt && opt.on) {
      optCount += 1;
      if (OPT_RULES.indexOf(opt.rule) < 0) errors.push(sym + ' 的期权节奏不合法');
      if (opt.rule === 'everyNw') {
        const w = Number(opt.weeks);
        if (!(w >= OPT_WEEKS_MIN && w <= OPT_WEEKS_MAX)) errors.push(sym + ' 的周数要在 ' + OPT_WEEKS_MIN + '–' + OPT_WEEKS_MAX + ' 之间');
        if (!isFriday(opt.anchor)) errors.push(sym + ' 的锚点必须是周五');
      }
      const o = Number(opt.otm);
      if (!(o >= OTM_MIN && o <= OTM_MAX)) errors.push(sym + ' 的 OTM 要在 ' + OTM_MIN + '–' + OTM_MAX + '% 之间');
    }
  });
  if (Math.abs(sum - 1) > 0.005) errors.push('目标比例合计要等于 100%（现在是 ' + Math.round(sum * 1000) / 10 + '%）');
  if (optCount > MAX_OPTION_SYMS) errors.push('参与期权的标的最多 ' + MAX_OPTION_SYMS + ' 只');
  if (optCount === 0) warnings.push('没有任何标的参与 Covered Call');
  return { ok: errors.length === 0, errors: errors, warnings: warnings };
}
