export async function serveAsset(request, url, env) {
  try {
    const asset = await env.ASSETS.fetch(new URL(url.pathname, request.url));
    if (asset.status !== 404 && asset.body) {
      const headers = new Headers(asset.headers);
      // 启动图与图标是纯装饰的静态资源，给长缓存：
      // iOS 冷启动要先拿到启动图才会画出来，如果每次都要回源（no-store），
      // 启动画面本身就会卡成一次网络往返 —— 反而更像白屏。
      if (/^\/(splash\/|icon[\w.-]*\.png$)/.test(url.pathname)) {
        headers.set('Cache-Control', 'public, max-age=2592000');
      } else {
        headers.set('Cache-Control', 'no-store, max-age=0');
      }
      return new Response(asset.body, { status: asset.status, headers });
    }
  } catch (error) {
    console.error(error);
  }
  return null;
}
