export const SYNC_KEYS = new Set([
  'trades',
  'cashBalance',
  'cashLog',
  'state',
  'activities',
  'optionTrades',
  'otmSettings',
  'exit_portfolio',
  'prices',
]);

export const corsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
});

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: corsHeaders() });
