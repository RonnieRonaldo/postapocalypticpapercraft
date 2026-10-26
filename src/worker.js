const PRICE_ID = 'pri_01m5wafsm0a25dwx72xhvf0cx3';
const PRODUCT_ID = 'pro_01m5wacs28dn9tjjcka49ggtq7';
const encoder = new TextEncoder();

function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function hexToBytes(hex) {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) return null;
  return Uint8Array.from(hex.match(/../g), s => parseInt(s, 16));
}
async function verifyPaddle(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const parts = Object.fromEntries(signature.split(';').map(p => p.trim().split('=', 2)));
  const ts = parts.ts;
  const h1 = parts.h1;
  if (!/^\d+$/.test(ts || '') || !/^[0-9a-f]{64}$/i.test(h1 || '')) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(`${ts}:${rawBody}`)));
  return constantTimeEqual(mac, hexToBytes(h1));
}
const noStore = { 'Cache-Control': 'no-store' };
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return Response.json({ status: 'ok', downloadsConfigured: Boolean(env.DOWNLOADS), webhookSecretConfigured: Boolean(env.PADDLE_WEBHOOK_SECRET) }, { headers: noStore });
    }
    if (url.pathname === '/api/paddle-webhook') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { ...noStore, Allow: 'POST' } });
      if (!env.PADDLE_WEBHOOK_SECRET) return new Response('Webhook not configured', { status: 503, headers: noStore });
      const raw = await request.text();
      if (raw.length > 128000) return new Response('Payload too large', { status: 413, headers: noStore });
      const valid = await verifyPaddle(raw, request.headers.get('Paddle-Signature'), env.PADDLE_WEBHOOK_SECRET);
      if (!valid) return new Response('Invalid signature', { status: 401, headers: noStore });
      let event;
      try { event = JSON.parse(raw); } catch { return new Response('Invalid JSON', { status: 400, headers: noStore }); }
      if (event.event_type !== 'transaction.completed') return Response.json({ received: true, processed: false }, { headers: noStore });
      const items = event.data?.items || [];
      const matches = items.some(item => item.price?.id === PRICE_ID && item.price?.product_id === PRODUCT_ID);
      // Intentionally no entitlement issuance until durable idempotent storage and delivery are implemented.
      // Respond with a non-2xx status for matching transactions to avoid falsely acknowledging fulfillment.
      if (matches) return new Response('Fulfillment not configured', { status: 503, headers: noStore });
      return Response.json({ received: true, processed: false }, { headers: noStore });
    }
    if (url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404, headers: noStore });
    return env.ASSETS.fetch(request);
  }
};
