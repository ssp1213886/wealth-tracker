// 渲染工具单测（src/app/render.js）：HTML 转义、空态结构、提醒条渲染与指纹。
import test from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, emptyStateHTML, renderAlertItem, alertSignature } from '../src/app/render.js';

test('escapeHtml：转义会破坏结构的五个字符', () => {
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  assert.equal(escapeHtml('a & b'), 'a &amp; b');
  assert.equal(escapeHtml('say "hi"'), 'say &quot;hi&quot;');
  assert.equal(escapeHtml("it's"), 'it&#39;s');
  assert.equal(escapeHtml('正常文本'), '正常文本');
});

test('escapeHtml：超长输入被截断（沿用 cleanText 的 500 上限）', () => {
  const long = 'x'.repeat(800);
  assert.equal(escapeHtml(long).length, 500);
});

test('emptyStateHTML：默认结构包含图标、标题与提示', () => {
  const html = emptyStateHTML({ title: '暂无持仓', hint: '录入第一笔交易' });
  assert.ok(html.includes('class="ds-empty"'));
  assert.ok(html.includes('ds-empty-icon'));
  assert.ok(html.includes('暂无持仓'));
  assert.ok(html.includes('录入第一笔交易'));
  assert.ok(html.includes('role="status"'));
});

test('emptyStateHTML：compact 变体与自定义图标', () => {
  const html = emptyStateHTML({ title: 'T', hint: 'H', compact: true, icon: '<svg id="custom"></svg>' });
  assert.ok(html.includes('ds-empty ds-empty-compact'));
  assert.ok(html.includes('id="custom"'));
});

test('emptyStateHTML：标题里的尖括号会被转义，不会破坏结构', () => {
  const html = emptyStateHTML({ title: '<b>x</b>', hint: 'a & b' });
  assert.ok(!html.includes('<b>x</b>'), '标题不应注入原始标签');
  assert.ok(html.includes('&lt;b&gt;'));
});

test('renderAlertItem：用户可控字段全部转义，图标按类型取', () => {
  const icons = { red: '<svg id="red"></svg>', blue: '<svg id="blue"></svg>' };
  const html = renderAlertItem(
    { id: 'a"1', type: 'red', severity: 'critical', title: '<img src=x>', detail: 'd', action: 'option' },
    icons,
  );
  assert.ok(html.includes('id="red"'), '应使用 red 图标');
  assert.ok(html.includes('&lt;img src=x&gt;'), '标题应被转义');
  assert.ok(!html.includes('<img src=x>'));
  assert.ok(html.includes('data-alert-action="option"'));
});

test('renderAlertItem：未知类型回退到 blue 图标', () => {
  const icons = { red: 'R', blue: 'B' };
  const html = renderAlertItem({ id: 'x', type: 'unknown', severity: 'low', title: 't' }, icons);
  assert.ok(html.includes('>B<') || html.includes('B'));
});

test('alertSignature：与顺序无关、随严重度变化、异常输入不抛错', () => {
  const a = [{ id: 'x', severity: 'high' }, { id: 'y', severity: 'low' }];
  const b = [{ id: 'y', severity: 'low' }, { id: 'x', severity: 'high' }];
  assert.equal(alertSignature(a), alertSignature(b));
  assert.notEqual(alertSignature(a), alertSignature([{ id: 'x', severity: 'critical' }, { id: 'y', severity: 'low' }]));
  assert.equal(alertSignature([]), '');
  assert.equal(alertSignature(null), '');
  assert.equal(alertSignature([{ id: 'x', severity: 'low' }]), 'x:low');
});
