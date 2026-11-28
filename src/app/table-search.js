import { matchRowText, searchCountText } from './rows.js';

let query = '';

/* v442：搜索范围 = 三张明细表 + 操作日志。
   以前只扫 holdBody/tradeBody/cashLogBody，README 说"跨两段生效"，日志分段却永远搜不到。 */
const SEARCH_HOSTS = [
  // 手机端持仓明细是 div 行（#holdList），桌面端是表格（#holdBody）—— 按视口只扫可见的那一份，
  // 否则计数会把同一只标的算两遍。
  { id: 'holdBody', selector: 'tr', desktopOnly: true },
  { id: 'holdList', selector: '.hold-li', mobileOnly: true },
  { id: 'tradeBody', selector: 'tr' },
  { id: 'cashLogBody', selector: 'tr' },
  { id: 'activityLog', selector: '.activity-item' },
];

function skipHost(host) {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  const mobile = window.matchMedia('(max-width: 800px)').matches;
  if (host.mobileOnly && !mobile) return true;
  if (host.desktopOnly && mobile) return true;
  return false;
}

function isPlaceholder(el) {
  return !!(el.querySelector && (el.querySelector('.table-empty') || el.querySelector('.ds-empty')));
}

export function applyTableSearch() {
  const q = query.trim().toLowerCase();
  let total = 0;
  let matched = 0;
  let first = null;
  SEARCH_HOSTS.forEach((host) => {
    if (skipHost(host)) return;
    const body = document.getElementById(host.id);
    if (!body) return;
    Array.from(body.querySelectorAll(host.selector)).forEach((row) => {
      if (isPlaceholder(row)) return;
      total += 1;
      const hit = matchRowText(row.textContent, q);
      row.style.display = hit ? '' : 'none';
      row.classList.toggle('is-hidden-row', !hit);
      if (hit) {
        matched += 1;
        if (!first && q) first = row;
      }
    });
  });
  const counter = document.getElementById('dsSearchCount');
  if (counter) counter.textContent = searchCountText(matched, q);
  const clear = document.getElementById('dsSearchClear');
  if (clear) clear.hidden = !q;
  const empty = document.getElementById('dsSearchEmpty');
  if (empty) empty.hidden = !(q && matched === 0);
  if (q && first) {
    first.classList.add('is-search-hit');
    setTimeout(() => first.classList.remove('is-search-hit'), 1200);
    if (!first._jumpLock) {
      first._jumpLock = true;
      try { first.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (error) { first.scrollIntoView(); }
      setTimeout(() => { first._jumpLock = false; }, 1400);
    }
  }
  return { total, matched };
}

export function initTableSearch() {
  const input = document.getElementById('dsSearchInput');
  if (!input) return;
  let timer = null;
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const value = input.value;
    timer = setTimeout(() => {
      query = value;
      applyTableSearch();
    }, 120);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    input.value = '';
    query = '';
    applyTableSearch();
  });
  const clear = document.getElementById('dsSearchClear');
  if (clear) {
    clear.addEventListener('click', () => {
      input.value = '';
      query = '';
      applyTableSearch();
      input.focus();
    });
  }
  SEARCH_HOSTS.forEach((host) => {
    const body = document.getElementById(host.id);
    if (body && window.MutationObserver) {
      new MutationObserver(() => applyTableSearch()).observe(body, { childList: true });
    }
  });
  applyTableSearch();
}
