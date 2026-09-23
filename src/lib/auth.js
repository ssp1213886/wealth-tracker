export function isAuthorized(request, env) {
  const token = request.headers.get('X-Auth-Token');
  return Boolean(token && env.AUTH_TOKEN && token === env.AUTH_TOKEN);
}

export function authRequired(url) {
  return url.pathname.startsWith('/api/') && url.pathname !== '/api/price';
}
