// Worker 侧图标代理（src/lib/logos.js）：入参校验 + 不把上游错误当图片返回。
// 这里只测"不依赖边缘缓存"的分支（Node 里没有 caches.default，函数会自己降级）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleLogo } from '../src/lib/logos.js';

const call = (symbol) => {
  const u = new URL('https://example.com/api/logo?symbol=' + encodeURIComponent(symbol));
  return handleLogo(new Request(u.toString()), u);
};

test('handleLogo：非法代码一律 400（防注入/防越权取图）', async () => {
  for (const bad of ['', '..', 'AA PL', "AAA'; DROP", 'AAA/BBB', 'TOOLONGSYM', '<script>', '1234']) {
    const res = await call(bad);
    assert.equal(res.status, 400, bad + ' 应该被拒');
    assert.match(res.headers.get('Content-Type') || '', /application\/json/);
  }
});

test('handleLogo：合法代码会去上游取（上游可达时返回图片，不可达时返回 502/404，绝不返回 JSON 当图片）', async () => {
  const res = await call('AAPL');
  assert.ok([200, 404, 502].includes(res.status), '状态码应为 200/404/502，实际 ' + res.status);
  if (res.status === 200) {
    assert.match(res.headers.get('Content-Type') || '', /^image\//);
    assert.match(res.headers.get('Cache-Control') || '', /max-age=604800/);
    const buf = await res.arrayBuffer();
    assert.ok(buf.byteLength > 200, '图太小会被当成占位图');
  } else {
    assert.match(res.headers.get('Content-Type') || '', /application\/json/);
  }
});

test('handleLogo：代码大小写不敏感，BRK-B 这类带连字符的放行', async () => {
  for (const ok of ['aapl', 'BRK-B', 'BRK.B', 'tsm']) {
    const res = await call(ok);
    assert.notEqual(res.status, 400, ok + ' 不该被判非法');
  }
});
