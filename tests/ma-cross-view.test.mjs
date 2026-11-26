import test from 'node:test';
import assert from 'node:assert/strict';
import { maCrossHtml, maCrossItemHtml, renderMaCross } from '../src/app/ma-cross-view.js';

const EVENT = {
  id: 7, symbol: 'VGT', period: 200, fromSide: 'BELOW', toSide: 'ABOVE',
  price: 120.12, average: 100.08, triggeredAt: Date.UTC(2026, 10, 26, 22, 10),
};

test('maCrossItemHtml：显示上下穿、价格、均线和确认按钮', () => {
  const html = maCrossItemHtml(EVENT);
  assert.match(html, /VGT 上穿 200 日均线/);
  assert.match(html, /价格 \$120\.12/);
  assert.match(html, /200 日均线 \$100\.08/);
  assert.match(html, /data-ma-cross-ack="7"/);
  assert.match(html, /知道了/);
});

test('maCrossHtml：空态/加载/错误，以及多条事件容器', () => {
  assert.match(maCrossHtml([], { loading: true }), /读取均线穿越提醒/);
  assert.match(maCrossHtml([], { error: 'HTTP 500' }), /暂不可用/);
  assert.match(maCrossHtml([]), /暂无待确认/);
  const html = maCrossHtml([EVENT, Object.assign({}, EVENT, { id: 8, symbol: 'SMH', toSide: 'BELOW' })]);
  assert.equal((html.match(/ma-cross-item/g) || []).length, 2);
  assert.match(html, /SMH 下穿 200 日均线/);
});

test('renderMaCross：更新数量与列表容器', () => {
  const nodes = {
    maCrossList: { innerHTML: '' },
    maCrossCount: { textContent: '' },
  };
  const doc = { getElementById(id) { return nodes[id] || null; } };
  renderMaCross(doc, [EVENT]);
  assert.equal(nodes.maCrossCount.textContent, '1');
  assert.match(nodes.maCrossList.innerHTML, /VGT 上穿/);
});
