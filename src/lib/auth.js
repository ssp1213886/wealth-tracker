export function isAuthorized(request, env) {
  const token = request.headers.get('X-Auth-Token');
  return Boolean(token && env.AUTH_TOKEN && token === env.AUTH_TOKEN);
}

// 公开端点：行情代理、标的图标与前端错误上报（启动期出错时还拿不到鉴权 token；
// 图标是 <img src> 拉取的，浏览器没法带自定义 header，所以必须公开）
const PUBLIC_API_PATHS = new Set(['/api/price', '/api/log', '/api/quotes', '/api/holdings', '/api/logo']);

export function authRequired(url) {
  return url.pathname.startsWith('/api/') && !PUBLIC_API_PATHS.has(url.pathname);
}
