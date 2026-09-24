export function isAuthorized(request, env) {
  const token = request.headers.get('X-Auth-Token');
  return Boolean(token && env.AUTH_TOKEN && token === env.AUTH_TOKEN);
}

// 公开端点：行情代理与前端错误上报（启动期出错时还拿不到鉴权 token）
const PUBLIC_API_PATHS = new Set(['/api/price', '/api/log']);

export function authRequired(url) {
  return url.pathname.startsWith('/api/') && !PUBLIC_API_PATHS.has(url.pathname);
}
