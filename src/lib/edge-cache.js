// Cloudflare 边缘缓存的小封装。
//
// 为什么需要它：Worker 的内存缓存只活在**单个 isolate** 里，isolate 一被回收就全丢，
// 下次请求又要回源。边缘缓存（caches.default）是跨 isolate、跨冷启动都命中的，
// 只要是"同一份结果可以复用一会儿"的只读接口，都应该压一层在这里。
//
// Node（单测）里没有 caches，所有函数会自动降级成"未命中 / 不写"，不影响逻辑。

function getEdgeCache() {
  try {
    return (typeof caches !== 'undefined' && caches && caches.default) ? caches.default : null;
  } catch (error) {
    return null;
  }
}

/** 缓存键用自己域名的固定路径，避免把不同来源的等价请求算成两份。 */
function cacheRequest(origin, key) {
  return new Request(new URL('/__edge/' + encodeURIComponent(key), origin).toString(), { method: 'GET' });
}

/** 命中返回解析后的 JSON；没命中返回 undefined。 */
export async function edgeGetJson(origin, key) {
  const cache = getEdgeCache();
  if (!cache) return undefined;
  try {
    const hit = await cache.match(cacheRequest(origin, key));
    if (!hit) return undefined;
    return await hit.json();
  } catch (error) {
    return undefined;
  }
}

export async function edgePutJson(origin, key, value, ttlSeconds) {
  const cache = getEdgeCache();
  if (!cache) return;
  try {
    await cache.put(cacheRequest(origin, key), new Response(JSON.stringify(value), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=' + ttlSeconds },
    }));
  } catch (error) {
    // 写缓存失败不影响本次返回
  }
}
