export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/health') {
      return Response.json({ status: 'ok', downloadsConfigured: Boolean(env.DOWNLOADS) }, {
        headers: { 'Cache-Control': 'no-store' }
      });
    }

    // No public download endpoint until Paddle purchases are verified server-side.
    if (url.pathname.startsWith('/api/')) {
      return new Response('Not found', { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
};
