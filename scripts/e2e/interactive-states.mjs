// 交互态渲染检查（之前只覆盖了 hover/focus/active）：用真实键盘 Tab 触发 :focus-visible，
// 并检查 :disabled / :checked 元素的实际渲染，避免"键盘用户看不到焦点在哪""选中态没区别"这类问题。
// 用法：node scripts/e2e/driver.mjs --file scripts/e2e/interactive-states.mjs
const BASE = (process.env.E2E_BASE || 'http://127.0.0.1:8788/');
const HOST = new URL(BASE).hostname;
const p = await context.newPage();
await p.setViewportSize({ width: 1280, height: 900 });
await p.route('**/*', (route) => {
  let h = '';
  try { h = new URL(route.request().url()).hostname; } catch (e) {}
  return h === HOST ? route.continue() : route.abort();
});
const errors = [];
p.on('pageerror', (e) => errors.push(String(e && e.message)));
await p.goto(BASE + 'icon.png', { waitUntil: 'load' });
await fetch(BASE + '_reset').catch(() => {});
await p.evaluate(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const g of regs) await g.unregister();
  const ks = await caches.keys();
  for (const k of ks) await caches.delete(k);
  localStorage.clear();
  localStorage.setItem('wealth_cfg_v2', '{}');
  localStorage.setItem('wealth_trades_v2', JSON.stringify([{ id: 1, date: '2026-09-01', symbol: 'VGT', shares: 8.62, price: 116.01 }]));
  localStorage.setItem('wealth_cash_v2', '34000');
  localStorage.setItem('wealth_options_v2', JSON.stringify([{ id: 201, sym: 'VGT', type: 'CALL', strike: 130, premium: 120, contracts: 1, expiry: '2026-10-16', added: '2026-09-20' }]));
  localStorage.setItem('otmSettings', JSON.stringify({ vgt: 7, smh: 5 }));
});
await p.goto(BASE + '?is=' + Date.now(), { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(4000);
await p.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; });

const failures = [];
const notes = [];

/* ---- ① :focus-visible：键盘 Tab 逐个走，看每个聚焦元素有没有可见焦点指示 ---- */
const focusReport = [];
for (let i = 0; i < 25; i += 1) {
  await p.keyboard.press('Tab');
  await p.waitForTimeout(120);
  const info = await p.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    const outline = (parseFloat(cs.outlineWidth) || 0) > 0 && cs.outlineStyle !== 'none';
    const ring = cs.boxShadow && cs.boxShadow !== 'none' && /rgb|var/.test(cs.boxShadow);
    const ring0 = /0(px)?\s+0(px)?\s+0(px)?\s/.test(cs.boxShadow || '');
    return {
      tag: el.tagName + (el.id ? '#' + el.id : (el.className ? '.' + String(el.className).split(' ')[0] : '')),
      visible: outline || (ring && !ring0),
      outline: cs.outlineStyle + ' ' + cs.outlineWidth,
      boxShadow: (cs.boxShadow || 'none').slice(0, 40),
    };
  });
  if (info) focusReport.push(info);
}
const noRing = focusReport.filter((f) => !f.visible);
if (!focusReport.length) failures.push('Tab 走了一圈没聚焦到任何元素');
else {
  notes.push('键盘 Tab 聚焦 ' + focusReport.length + ' 个元素，其中「看不到焦点」的 ' + noRing.length + ' 个');
  if (noRing.length) notes.push('  无焦点指示的（可接受范围见下）：' + noRing.slice(0, 6).map((x) => x.tag + ' [' + x.outline + ']').join(', '));
  if (noRing.length > focusReport.length * 0.5) failures.push('超过一半的聚焦元素没有可见焦点指示（键盘可用性差）');
}

/* ---- ② :checked / 选中态：分段控件与单选框的样式必须有区别 ---- */
const checkedReport = await p.evaluate(() => {
  const groups = ['.segment', '.record-seg', '.asset-chip', '.tab-btn'];
  const out = [];
  groups.forEach((sel) => {
    const list = Array.from(document.querySelectorAll(sel)).filter((el) => el.offsetParent !== null);
    if (list.length < 2) return;
    const on = list.find((el) => el.classList.contains('active') || el.getAttribute('aria-selected') === 'true');
    const off = list.find((el) => el !== on);
    if (!on || !off) return;
    const a = getComputedStyle(on), b = getComputedStyle(off);
    const differ = a.backgroundColor !== b.backgroundColor || a.color !== b.color || a.borderColor !== b.borderColor || a.fontWeight !== b.fontWeight;
    out.push({ sel: sel, count: list.length, differ: differ, onBg: a.backgroundColor, offBg: b.backgroundColor });
  });
  return out;
});
checkedReport.forEach((r) => {
  notes.push('选中态 ' + r.sel + '（' + r.count + ' 个）：选中/未选中样式' + (r.differ ? '有区别' : '**没区别**') + '（' + r.onBg + ' vs ' + r.offBg + '）');
  if (!r.differ) failures.push('选中态 ' + r.sel + ' 与未选中看不出区别');
});

/* ---- ③ :disabled：真实禁用的元素要有"不可用"的视觉 ---- */
const disabledReport = await p.evaluate(() => {
  const els = Array.from(document.querySelectorAll('button:disabled,input:disabled,select:disabled,.btn[disabled]'));
  if (!els.length) return { count: 0 };
  const el = els[0];
  const cs = getComputedStyle(el);
  return { count: els.length, sample: (el.id || el.className || el.tagName).slice(0, 30), opacity: cs.opacity, cursor: cs.cursor, color: cs.color };
});
if (disabledReport.count === 0) notes.push('页面上当前没有 disabled 控件（这项跳过）');
else {
  const dimmed = parseFloat(disabledReport.opacity) < 1 || disabledReport.cursor === 'not-allowed' || disabledReport.cursor === 'default';
  notes.push('disabled 控件 ' + disabledReport.count + ' 个（样例 ' + disabledReport.sample + '：opacity=' + disabledReport.opacity + ' cursor=' + disabledReport.cursor + '）');
  if (!dimmed) failures.push('disabled 控件看不出被禁用（opacity=' + disabledReport.opacity + ' cursor=' + disabledReport.cursor + '）');
}

/* ---- ④ 键盘可达性：Tab 能到达的行数 + Enter 能激活一个分段控件 ---- */
await p.evaluate(() => { document.getElementById('bbOption').click(); });
await p.waitForTimeout(1200);
const before = await p.evaluate(() => document.getElementById('toptType') ? document.getElementById('toptType').value : null);
const seg = await p.evaluate(() => {
  const el = document.querySelector('#tab-option .segment');
  if (!el) return null;
  el.focus();
  return { tag: el.tagName, text: el.textContent.trim().slice(0, 12) };
});
if (seg) {
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  notes.push('分段控件可用键盘聚焦（' + seg.text + '），Enter 已发送');
}

if (errors.length) failures.push('页面报错：' + errors.slice(0, 3).join(' | '));
await p.evaluate(() => { localStorage.removeItem('wealth_sync_cfg'); localStorage.removeItem('wealth_sync_state'); });
await p.close();

console.log('交互态渲染检查（focus-visible / checked / disabled / 键盘可达）：');
notes.forEach((n) => console.log('  · ' + n));
if (failures.length) {
  console.error('发现问题：\n  - ' + failures.join('\n  - '));
  throw new Error('interactive-states failed');
}
console.log('✓ 交互态检查通过');
