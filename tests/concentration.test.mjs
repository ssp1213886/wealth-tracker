import test from 'node:test';
import assert from 'node:assert/strict';
import { concentrationSummary, concentrationHtml } from '../src/app/concentration.js';

const rows = [
  { sym: '比特币', share: 18.5, parts: ['IBIT 1:1'] },
  { sym: 'NVDA', share: 14.5, parts: ['VGT 17.74%', 'SMH 19.28%'] },
  { sym: 'AAPL', share: 9.5, parts: ['VGT 15.80%'] },
  { sym: 'MSFT', share: 6.6, parts: ['VGT 11.52%'] },
  { sym: 'AVGO', share: 3.7, parts: ['VGT 4.52%', 'SMH 5.25%'] },
  { sym: 'MU', share: 3.5, parts: ['VGT 4.18%', 'SMH 5.05%'] },
];

test('concentrationSummary：最大资产、Top N、重叠、HHI、科技仓位', () => {
  const s = concentrationSummary({
    rows,
    etfRest: [{ label: 'VGT 其余', share: 19.4 }, { label: 'SMH 其余', share: 8.9 }],
    base: 1000,
    valueByEtf: { VGT: 500, SMH: 300 },
  });
  assert.equal(s.max.sym, '比特币');
  assert.equal(s.top3, 42.5);
  assert.equal(s.top5, 52.8);
  assert.equal(s.overlapShare, 21.7);
  assert.equal(s.overlapCount, 3);
  assert.ok(s.hhi > 0);
  assert.equal(s.hhiLabel, '高度集中', '科技 ETF 占 80% 时应提示高度集中，不能只看 HHI 数字');
  assert.equal(s.techShare, 80);
});

test('concentrationHtml：摘要与重叠来源可见', () => {
  const html = concentrationHtml(concentrationSummary({
    rows,
    etfRest: [],
    base: 1000,
    valueByEtf: { VGT: 500, SMH: 300 },
  }));
  assert.match(html, /集中度摘要/);
  assert.match(html, /最大底层资产/);
  assert.match(html, /重叠成分股/);
  assert.match(html, /NVDA/);
  assert.match(html, /VGT 17\.74% \+ SMH 19\.28%/);
  assert.match(html, /VGT \+ SMH 占持仓市值 80\.0%/);
});
