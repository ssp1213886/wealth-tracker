/**
 * 一个请求要看哪几个文件。
 *
 * ⚠️ 开了 run_worker_first 之后，**资源绑定只按精确路径找文件**，不再自动做
 * "目录 → index.html" 和 "无扩展名 → .html" 这两种映射（那是资源层在前置模式下帮忙做的）。
 * 所以 `/` 必须显式取 `/index.html`，否则会 404 —— 表现就是登录后跳回首页看到
 * `{"error":"Not Found"}`。
 */
function assetCandidates(pathname) {
  if (pathname === '/' || pathname === '') return ['/index.html'];
  const list = [pathname];
  const last = pathname.slice(pathname.lastIndexOf('/') + 1);
  // 没有扩展名的路径再试一次 .html（/guide → /guide.html）
  if (!/\.[a-z0-9]+$/i.test(last)) list.push(pathname.replace(/\/$/, '') + '.html');
  return list;
}

/** 启动图与图标是纯装饰的静态资源，给长缓存；其余一律 no-store（由 Service Worker 管）。 */
function cacheControlFor(pathname) {
  return /^\/(splash\/|icon[\w.-]*\.png$)/.test(pathname)
    ? 'public, max-age=2592000'
    : 'no-store, max-age=0';
}

export async function serveAsset(request, url, env) {
  for (const candidate of assetCandidates(url.pathname)) {
    try {
      const asset = await env.ASSETS.fetch(new URL(candidate, request.url));
      if (asset.status === 404 || !asset.body) continue;
      const headers = new Headers(asset.headers);
      headers.set('Cache-Control', cacheControlFor(url.pathname));
      return new Response(asset.body, { status: asset.status, headers });
    } catch (error) {
      console.error(error);
    }
  }
  return null;
}
