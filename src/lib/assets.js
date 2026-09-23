export async function serveAsset(request, url, env) {
  try {
    const asset = await env.ASSETS.fetch(new URL(url.pathname, request.url));
    if (asset.status !== 404 && asset.body) {
      const headers = new Headers(asset.headers);
      headers.set('Cache-Control', 'no-store, max-age=0');
      return new Response(asset.body, { status: asset.status, headers });
    }
  } catch (error) {
    console.error(error);
  }
  return null;
}
