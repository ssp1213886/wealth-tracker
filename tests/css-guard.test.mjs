// 样式债守卫自身的单测：预算判定 + :hover 包裹判定
// （以前这两条只写在 lint 脚本里，改错了没人拦；抽成模块后可以离线验证。）
import test from 'node:test';
import assert from 'node:assert/strict';
import { countImportant, findUnwrappedHover, hoverMediaRanges, checkStyles, IMPORTANT_BUDGET } from '../scripts/css-guard.mjs';

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
