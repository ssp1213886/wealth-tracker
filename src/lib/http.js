export const SYNC_KEYS = new Set([
  'trades',
  'cashBalance',
  'cashLog',
  'state',
  'activities',
  'optionTrades',
  'otmSettings',
  'exit_portfolio',
  'watchlist',
  'prices',
]);

export const corsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  // 所有 JSON（尤其是 404/401 这种错误）都不许被缓存：
  // 曾经有个 404 被浏览器/边缘缓存下来，修好之后用户刷新还是看到旧的 {"error":"Not Found"}。
  'Cache-Control': 'no-store, max-age=0',
});

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
