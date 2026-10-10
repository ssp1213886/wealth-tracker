// 观察列表搜索模块单测（从 index.js 抽出后新增，此前只能靠肉眼点页面验证）
import test from 'node:test';
import assert from 'node:assert/strict';
import { searchSymbols, SEARCH_LIST_COUNT, SEARCH_INDEX_COUNT, JUNK } from '../src/app/symbols.js';

test('名单规模：别名表 61 条、内置指数名单 167 条（S&P100 ∪ 纳斯达克100）', () => {
  assert.equal(SEARCH_LIST_COUNT, 61);
  assert.equal(SEARCH_INDEX_COUNT, 167);
});

test('searchSymbols: 代码前缀优先，中文别名与英文名都能命中', () => {
  assert.deepEqual(searchSymbols('berkshire').slice(0, 2), [['BRK-B', 'Berkshire Hathaway B'], ['BRK-A', 'Berkshire Hathaway A']]);
  assert.equal(searchSymbols('tsl')[0][0], 'TSLA');
  assert.equal(searchSymbols('英伟达')[0][0], 'NVDA');
  assert.equal(searchSymbols('特斯拉')[0][0], 'TSLA');
});

test('searchSymbols: 指数名单可按代码/名称命中，且代码前缀排在前面', () => {
  assert.equal(searchSymbols('app')[0][0], 'APP');       // AppLovin（纳指成分）
  assert.equal(searchSymbols('arm')[0][0], 'ARM');       // Arm Holdings
  assert.ok(searchSymbols('regeneron').some(([sym]) => sym === 'REGN'));
});

test('searchSymbols: 过滤杠杆/反向 ETF 噪音，但代码完全相同时放行', () => {
  // 名字带 daily/2x/short 的会被 JUNK 过滤
  const daily = searchSymbols('daily');
  assert.equal(daily.length, 0, '不该出现带 daily 的杠杆 ETF');
  assert.ok(JUNK.test('2x Long TSLA'));
  // 代码整体相同（如 TSLQ 之类）不在此名单里，这里直接验 JUNK 只作用于名称匹配
  assert.equal(searchSymbols('2x').length, 0);
});

test('searchSymbols: 空查询与未知代码返回空数组；结果条数受限', () => {
  assert.deepEqual(searchSymbols(''), []);
  assert.deepEqual(searchSymbols('   '), []);
  assert.deepEqual(searchSymbols('zzzz-not-exist'), []);
  assert.ok(searchSymbols('a').length <= 8);
  assert.ok(searchSymbols('a', 3).length <= 3);
});

test('searchSymbols: 结果去重（别名表与指数名单重叠时只出一条）', () => {
  const hits = searchSymbols('nvda', 8).map(([sym]) => sym);
  assert.deepEqual(hits, [...new Set(hits)]);
});
