import { matchRowText, searchCountText } from './rows.js';

let query = '';

export function applyTableSearch() {
  const q = query.trim().toLowerCase();
  let total = 0;
  let matched = 0;
  let first = null;
  ['holdBody', 'tradeBody', 'cashLogBody'].forEach((id) => {
    const body = document.getElementById(id);
    if (!body) return;
    Array.from(body.querySelectorAll('tr')).forEach((row) => {
      if (row.querySelector('.table-empty') || row.querySelector('.ds-empty')) return;
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
  ['holdBody', 'tradeBody', 'cashLogBody'].forEach((id) => {
    const body = document.getElementById(id);
    if (body && window.MutationObserver) {
      new MutationObserver(() => applyTableSearch()).observe(body, { childList: true });
    }
  });
  applyTableSearch();
}
