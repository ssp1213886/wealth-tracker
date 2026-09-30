// 静态资源寻址（src/lib/assets.js）。
//
// 这组用例钉住一个真实事故：开了 run_worker_first 之后，资源绑定只按**精确路径**找文件，
// 不再自动把 `/` 映射到 `/index.html` —— 于是登录成功跳回首页看到 {"error":"Not Found"}。
import test from 'node:test';
import assert from 'node:assert/strict';
import { serveAsset } from '../src/lib/assets.js';

function fakeEnv(files) {
  const seen = [];
  return {
    seen,
    env: {
      ASSETS: {
        fetch: async (target) => {
          // fetch 的目标可能是字符串、URL 或 Request —— 三种都要能取到路径
          const path = new URL(typeof target === 'string' ? target : (target.href || target.url)).pathname;
          seen.push(path);
          if (files[path] === undefined) return new Response(null, { status: 404 });
          return new Response(files[path].body, { status: 200, headers: { 'Content-Type': files[path].type } });
        },
      },
    },
  };
}

test('serveAsset：根路径必须落到 index.html', async () => {
  const { env, seen } = fakeEnv({ '/index.html': { body: '<!doctype html>SHELL', type: 'text/html' } });
  const res = await serveAsset(new Request('https://x.dev/'), new URL('https://x.dev/'), env);
  assert.equal(seen[0], '/index.html');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '<!doctype html>SHELL');
  assert.equal(res.headers.get('Cache-Control'), 'no-store, max-age=0');
});

test('serveAsset：无扩展名的路径回退到 .html（/guide → /guide.html）', async () => {
  const { env, seen } = fakeEnv({ '/guide.html': { body: '<!doctype html>GUIDE', type: 'text/html' } });
  const res = await serveAsset(new Request('https://x.dev/guide'), new URL('https://x.dev/guide'), env);
  assert.deepEqual(seen, ['/guide', '/guide.html']);
  assert.equal(await res.text(), '<!doctype html>GUIDE');
});

test('serveAsset：精确命中的资源不会被多余回退，图标/启动图仍拿长缓存', async () => {
  const { env, seen } = fakeEnv({ '/icon-180.png': { body: 'PNG', type: 'image/png' } });
  const res = await serveAsset(new Request('https://x.dev/icon-180.png'), new URL('https://x.dev/icon-180.png'), env);
  assert.deepEqual(seen, ['/icon-180.png']);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=2592000');
});

test('serveAsset：都找不到时返回 null（交给上层出 404）', async () => {
  const { env } = fakeEnv({});
  const res = await serveAsset(new Request('https://x.dev/nope.php'), new URL('https://x.dev/nope.php'), env);
  assert.equal(res, null);
});
