// 云端 prices 只是"可再生的缓存"，不是权威数据。
// 拉取时只允许"变新"，绝不允许把本机刚拿到的实时报价覆盖回旧值。
//
// v398 修的线上问题（实测时序）：
//   0.9s /api/quotes 返回 → 持仓市值 $1,448.51（正确）
//   1.5s /api/sync 返回   → 旧价写回 → 持仓市值退回 $2,004.04（错 38%）
// 旧实现只比较「云端 vs 本地缓存」，而本地缓存本身也停在旧日期，于是每次都"合法"覆盖。
// 这里改成三方取最大：本地缓存 / 实时报价 / 云端，只有云端严格更新才采用。

/**
 * @param {{cloud?:Object, cache?:Object, live?:Object}} opts
 *   cloud 云端 prices（symbol → {price,time,...}）
 *   cache 本地 price cache（symbol → {price,time,...}）
 *   live  内存实时报价 liveQuoteData（symbol → {price,time,...}）
 * @returns {{changed:boolean, patch:Object, livePrices:Object}}
 *   patch     需要合并进本地 cache 的条目
 *   livePrices 需要写进 livePrices 的现价（只在云端严格更新时出现）
 */
export function mergePullPrices(opts) {
  const o = opts || {};
  const cloud = o.cloud || {};
  const cache = o.cache || {};
  const live = o.live || {};
  const patch = {};
  const livePrices = {};
  let changed = false;

  Object.keys(cloud).forEach(function (sym) {
    const c = cloud[sym];
    if (!c || typeof c !== 'object') return;
    const price = Number(c.price);
    if (!(price > 0)) return;

    const ts = Number(c.time) || 0;
    const cacheTs = Number((cache[sym] || {}).time) || 0;
    const liveTs = Number((live[sym] || {}).time) || 0;
    const newestLocal = Math.max(cacheTs, liveTs);

    // 没有时间戳的历史数据：只在本地完全没有这个标的时才采用，绝不覆盖已有值
    if (!ts) {
      if (cache[sym] || live[sym]) return;
      patch[sym] = c;
      livePrices[sym] = price;
      changed = true;
      return;
    }

    // 核心：同刻或更旧一律跳过（旧实现是 >=，等值也会覆盖）
    if (ts <= newestLocal) return;
    patch[sym] = c;
    livePrices[sym] = price;
    changed = true;
  });

  return { changed: changed, patch: patch, livePrices: livePrices };
}
