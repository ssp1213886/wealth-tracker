// 样式债守卫自身的单测：预算判定 + :hover 包裹判定
// （以前这两条只写在 lint 脚本里，改错了没人拦；抽成模块后可以离线验证。）
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countImportant, findUnwrappedHover, hoverMediaRanges, checkStyles, IMPORTANT_BUDGET,
  findAccentInSemanticRules,
} from '../scripts/css-guard.mjs';

const wrap = (inner) => '@media (hover:hover) and (pointer:fine){' + inner + '}';

test('countImportant: 统计所有出现（含注释，避免用注释绕过预算）', () => {
  assert.equal(countImportant(''), 0);
  assert.equal(countImportant('.a{color:red}'), 0);
  assert.equal(countImportant('.a{color:red!important}'), 1);
  assert.equal(countImportant('.a{color:red!important}.b{color:blue!important}'), 2);
  assert.equal(countImportant('/* 计划删掉这条 !important */'), 1);
});

test('hoverMediaRanges: 能算准嵌套在媒体查询里的区间', () => {
  const css = wrap('.a:hover{color:red}') + '.b:hover{color:blue}';
  const ranges = hoverMediaRanges(css);
  assert.equal(ranges.length, 1);
  const [start, end] = ranges[0];
  assert.ok(css.slice(start, end).includes('.a:hover'));
  assert.ok(!css.slice(start, end).includes('.b:hover'));
});

test('findUnwrappedHover: 未包裹的 :hover 会被抓出来', () => {
  assert.deepEqual(findUnwrappedHover('.a:hover{color:red}'), ['.a:hover']);
  assert.deepEqual(findUnwrappedHover(wrap('.a:hover{color:red}')), []);
  const mixed = findUnwrappedHover(wrap('.a:hover{color:red}') + '.b:hover{color:blue}');
  assert.equal(mixed.length, 1);
  assert.match(mixed[0], /\.b:hover/);
});

test('findUnwrappedHover: @media 里但条件不足（缺 pointer:fine）也算未包裹', () => {
  assert.deepEqual(findUnwrappedHover('@media (hover:hover){.a:hover{color:red}}'), ['.a:hover']);
});

test('checkStyles: 预算内放行，超一条就拦下', () => {
  const ok = checkStyles('.a{color:red!important}', 1);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.important, 1);

  const over = checkStyles('.a{color:red!important}.b{color:blue!important}', 1);
  assert.equal(over.errors.length, 1);
  assert.match(over.errors[0], /超过基线 1/);
});

test('checkStyles: 汇总 hover 包裹情况（给 lint 打印用）', () => {
  const r = checkStyles(wrap('.a:hover{color:red}') + '.b:hover{color:blue}', 0);
  assert.equal(r.hoverAll, 2);
  assert.equal(r.hoverWrapped, 1);
  assert.equal(r.hoverUnwrapped, 1);
  assert.equal(r.errors.length, 1);
});

test('checkStyles: 真实 main.css 必须过守卫（防止有人偷偷加债）', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync('public/assets/main.css', 'utf8');
  const r = checkStyles(css, IMPORTANT_BUDGET);
  assert.deepEqual(r.errors, [], 'main.css 不该超出 :hover/!important 守卫');
  assert.ok(r.important <= IMPORTANT_BUDGET);
});

// v385：涨跌/盈亏这类"数据状态色"不许用随配色方案变的 --accent
// （否则同一个"上涨"在 warm 下变橙、plum 下变成 VGT 的紫、mono 下变灰）
test('findAccentInSemanticRules: 抓住"数据状态选择器用了 --accent"', () => {
  assert.deepEqual(findAccentInSemanticRules('.pnl-pos{color:var(--accent)}'), ['.pnl-pos']);
  assert.deepEqual(findAccentInSemanticRules('.watch-chg.is-up{color:var(--accent)}'), ['.watch-chg.is-up']);
  assert.deepEqual(findAccentInSemanticRules('.row-detail.hold-detail .positive{color:var(--accent)}'), ['.row-detail.hold-detail .positive']);
  assert.deepEqual(findAccentInSemanticRules('@media(min-width:801px){.is-down{color:var(--accent)}}'), ['.is-down']);
});

test('findAccentInSemanticRules: 语义色、界面 chrome、注释都不算违规', () => {
  assert.deepEqual(findAccentInSemanticRules('.pnl-pos{color:var(--ok)}'), []);
  assert.deepEqual(findAccentInSemanticRules('.pnl-neg{color:var(--danger)}'), []);
  // 界面 chrome（按钮/选中态/焦点环）本来就该用主题色
  assert.deepEqual(findAccentInSemanticRules('.btn{background:var(--accent)}'), []);
  assert.deepEqual(findAccentInSemanticRules('.prob-chip.is-on{color:var(--accent-d)}'), []);
  // 解释性注释里提到 --accent 不算违规
  assert.deepEqual(findAccentInSemanticRules('.pnl-pos{/* 以前是 var(--accent) */color:var(--ok)}'), []);
});

test('findAccentInSemanticRules: 真实 main.css 必须是干净的', async () => {
  const fs = await import('node:fs');
  const css = fs.readFileSync('public/assets/main.css', 'utf8');
  assert.deepEqual(findAccentInSemanticRules(css), [], '这些"数据状态"规则还在用 --accent');
});
