const PRODUCTS = Object.freeze({
  box: {
    priceId: 'pri_01m5wafsm0a25dwx72xhvf0cx3',
    productId: 'pro_01m5wacs28dn9tjjcka49ggtq7',
    title: 'Gas Station Box',
    files: {
      a4: ['gas-stations/Gas-Station-Box.pdf', 'Gas-Station-Box.pdf'],
      us: ['gas-stations/Gas-Station-Box-US.pdf', 'Gas-Station-Box-US.pdf'],
      guide: ['gas-stations/Gas-Station-Box-How-To.pdf', 'Gas-Station-Box-How-To.pdf']
    }
  },
  deluxe: {
    priceId: 'pri_01m5yyanf62xmndpa0sschzcb8',
    productId: 'pro_01m5yy7bsq8kxf2rkdagbnbnk9',
    title: 'Abandoned Gas Station, Deluxe Edition',
    files: {
      a4: ['gas-stations/Gas-Station-Deluxe-A4.pdf', 'Gas-Station-Deluxe-A4.pdf'],
      us: ['gas-stations/Gas-Station-Deluxe-US.pdf', 'Gas-Station-Deluxe-US.pdf'],
      guide: ['gas-stations/Gas-Station-Box-How-To.pdf', 'Gas-Station-Box-How-To.pdf']
    }
  }
});
const te = new TextEncoder();
const NO_STORE = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const TTL = 7 * 86400;
const corsOrigin = 'https://postapocalypticpapercraft.com';
function json(data, status=200, extra={}) { return Response.json(data, {status, headers:{...NO_STORE,...extra}}); }
function randomHex(bytes=32) { const a=new Uint8Array(bytes);crypto.getRandomValues(a);return Array.from(a,x=>x.toString(16).padStart(2,'0')).join(''); }
async function sha256(value) { const d=await crypto.subtle.digest('SHA-256',te.encode(value));return Array.from(new Uint8Array(d),x=>x.toString(16).padStart(2,'0')).join(''); }
function cookies(req) { return Object.fromEntries((req.headers.get('Cookie')||'').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)];})); }
function setCookie(name,value,maxAge) {return `${name}=${value}; Path=/; Max-Age=${maxAge}; Secure; HttpOnly; SameSite=Lax`;}
function sameOrigin(req) {const o=req.headers.get('Origin');return o===corsOrigin || o===new URL(req.url).origin;}
function equal(a,b) {if(a.length!==b.length)return false;let v=0;for(let i=0;i<a.length;i++)v|=a[i]^b[i];return v===0;}
function fromHex(h){if(!/^[0-9a-f]{64}$/i.test(h||''))return null;return Uint8Array.from(h.match(/../g),x=>parseInt(x,16));}
async function verifyPaddle(raw,signature,secret){if(!signature||!secret)return false;const parts=Object.fromEntries(signature.split(';').map(p=>p.trim().split('=',2)));const ts=parts.ts;const mac=fromHex(parts.h1);if(!/^\d+$/.test(ts||'')||!mac||Math.abs(Date.now()/1000-Number(ts))>300)return false;const key=await crypto.subtle.importKey('raw',te.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);const actual=new Uint8Array(await crypto.subtle.sign('HMAC',key,te.encode(`${ts}:${raw}`)));return equal(actual,mac);}
function matchedProduct(data) {
  if (!Array.isArray(data?.items)) return null;
  const found = Object.entries(PRODUCTS).filter(([, p]) =>
    data.items.some(x => x.price?.id === p.priceId &&
      (x.price?.product_id === p.productId || x.product?.id === p.productId)));
  // Each checkout currently sells exactly one supported product. Never silently grant
  // only one entitlement for a multi-product cart.
  return found.length === 1 ? found[0][1] : null;
}
function validTxnId(id){return /^txn_[a-z0-9]{10,80}$/.test(id||'');}
async function saveOrder(env, data, product){
  await env.DB.prepare(`INSERT INTO orders (paddle_transaction_id,paddle_customer_id,product_id,price_id,payment_status) VALUES (?,?,?,?,?) ON CONFLICT(paddle_transaction_id) DO UPDATE SET payment_status=excluded.payment_status, updated_at=CURRENT_TIMESTAMP WHERE orders.product_id=excluded.product_id AND orders.price_id=excluded.price_id`).bind(data.id,data.customer_id||null,product.productId,product.priceId,'completed').run();
}
async function webhook(req,env){
  if(!env.PADDLE_WEBHOOK_SECRET||!env.DB)return json({error:'not configured'},503);
  const raw=await req.text();if(raw.length>128000)return json({error:'too large'},413);
  if(!await verifyPaddle(raw,req.headers.get('Paddle-Signature'),env.PADDLE_WEBHOOK_SECRET))return json({error:'invalid signature'},401);
  let event;try{event=JSON.parse(raw)}catch{return json({error:'invalid json'},400)}
  if(event.event_type!=='transaction.completed')return json({received:true,processed:false});
  const product=matchedProduct(event.data);
  if(!product)return json({received:true,processed:false});
  if(!validTxnId(event.data?.id)||!event.event_id)return json({error:'missing IDs'},400);
  try{
    await saveOrder(env,event.data,product);
    await env.DB.prepare('INSERT OR IGNORE INTO webhook_events (event_id,event_type,paddle_transaction_id) VALUES (?,?,?)').bind(event.event_id,event.event_type,event.data.id).run();
    return json({received:true,processed:true});
  }catch{return json({error:'database unavailable'},503)}
}
async function paddleTransaction(env,id){
  const res=await fetch(`https://api.paddle.com/transactions/${encodeURIComponent(id)}`,{headers:{Authorization:`Bearer ${env.PADDLE_API_KEY}`,Accept:'application/json'}});
  if(!res.ok)return null;
  const body=await res.json();return body.data;
}
function html(s){return new Response(s,{headers:{...NO_STORE,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}})}
async function entitlement(req,env){const token=cookies(req).postapo_access;if(!token||!/^[0-9a-f]{64}$/.test(token))return null;const hash=await sha256(token);return env.DB.prepare(`SELECT o.id,o.paddle_transaction_id,o.product_id FROM download_tokens t JOIN orders o ON o.id=t.order_id WHERE t.token_hash=? AND t.revoked_at IS NULL AND t.expires_at > datetime('now') AND o.payment_status='completed' LIMIT 1`).bind(hash).first();}
async function handle(req,env){
  const url=new URL(req.url),path=url.pathname;
  if(path==='/api/health')return json({status:'ok',downloadsConfigured:!!env.DOWNLOADS,webhookSecretConfigured:!!env.PADDLE_WEBHOOK_SECRET,databaseConfigured:!!env.DB,paddleApiConfigured:!!env.PADDLE_API_KEY});
  if(path==='/api/paddle-webhook')return req.method==='POST'?webhook(req,env):json({error:'method not allowed'},405,{Allow:'POST'});
  // Temporary admin-only Paddle API connectivity diagnostic. No customer data returned.
  if(path==='/api/admin/paddle-check' && req.method==='POST'){
    if(!env.PADDLE_DIAGNOSTIC_SECRET || !env.PADDLE_API_KEY) return json({error:'diagnostic not configured'},503);
    const provided=req.headers.get('X-Diagnostic-Token')||'';
    const expected=env.PADDLE_DIAGNOSTIC_SECRET;
    if(provided.length!==expected.length || !equal(te.encode(provided),te.encode(expected))) return json({error:'not found'},404);
    try{
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),8000);
      let response;
      try{response=await fetch('https://api.paddle.com/transactions?per_page=1',{
        headers:{'Authorization':`Bearer ${env.PADDLE_API_KEY}`,'Accept':'application/json'},signal:controller.signal
      });}finally{clearTimeout(timeout)}
      // Return only HTTP status and connectivity; never return Paddle payloads or credentials.
      return json({paddleApiReachable:response.ok,paddleStatus:response.status});
    }catch{return json({paddleApiReachable:false,error:'request failed'},502)}
  }

  if(!env.DB||!env.DOWNLOADS)return json({error:'service unavailable'},503);
  if(path==='/api/checkout-session'&&req.method==='POST'){
    if(!sameOrigin(req))return json({error:'origin rejected'},403);
    const nonce=randomHex();return json({checkoutNonce:nonce},200,{'Set-Cookie':setCookie('postapo_checkout',nonce,3600)});
  }
  if(path==='/api/claim'&&req.method==='POST'){
    if(!sameOrigin(req))return json({error:'origin rejected'},403);
    if(!env.PADDLE_API_KEY)return json({error:'not configured'},503);
    let body;try{body=await req.json()}catch{return json({error:'invalid JSON'},400)}
    const id=body?.transactionId,nonce=cookies(req).postapo_checkout;
    if(!validTxnId(id)||!nonce||!/^[0-9a-f]{64}$/.test(nonce))return json({error:'invalid claim'},400);
    let txn;try{txn=await paddleTransaction(env,id)}catch{return json({error:'Paddle unavailable'},503)}
    const product=matchedProduct(txn);
    if(!txn||txn.status!=='completed'||!product||txn.custom_data?.postapo_checkout_nonce!==nonce)return json({error:'transaction not eligible'},403);
    await saveOrder(env,txn,product);
    const order=await env.DB.prepare('SELECT id FROM orders WHERE paddle_transaction_id=?').bind(id).first();
    const token=randomHex(),hash=await sha256(token);
    await env.DB.prepare(`INSERT INTO download_tokens(order_id,token_hash,expires_at) VALUES(?,?,datetime('now','+7 days'))`).bind(order.id,hash).run();
    return json({ok:true,downloadPage:'/downloads'},200,{'Set-Cookie':setCookie('postapo_access',token,TTL)});
  }
  if(path==='/api/download-status'&&req.method==='GET')return json({authorized:!!(await entitlement(req,env))});
  if(path.startsWith('/api/file/')&&req.method==='GET'){
    const access=await entitlement(req,env);
    if(!access)return json({error:'access denied'},403);
    const product=Object.values(PRODUCTS).find(p=>p.productId===access.product_id);
    const file=product?.files[path.slice('/api/file/'.length)];
    if(!file)return json({error:'not found'},404);
    const obj=await env.DOWNLOADS.get(file[0]);if(!obj)return json({error:'file missing in R2'},404);
    return new Response(obj.body,{headers:{...NO_STORE,'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${file[1]}"`}});
  }
  if(path==='/downloads'&&req.method==='GET'){
    const access=await entitlement(req,env);
    if(!access)return html('<!doctype html><html lang="en"><meta charset="utf-8"><title>Download access</title><body style="font:18px system-ui;background:#171717;color:white;padding:4rem"><h1>Download access unavailable</h1><p>Complete your purchase first, or return to the checkout browser. Access expires after 7 days.</p><a style="color:#ff9b50" href="/">Back to website</a></body></html>');
    const product=Object.values(PRODUCTS).find(p=>p.productId===access.product_id);
    if(!product)return json({error:'product unavailable'},403);
    const safeTitle=product.title.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    return html(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Papercraft Downloads</title><style>body{font:17px system-ui;background:#171717;color:#f4ede4;max-width:740px;margin:8vh auto;padding:24px}a.file{display:block;margin:16px 0;padding:20px;border:1px solid #b96839;border-radius:12px;color:#fff;text-decoration:none;background:#30241e}small{color:#bbb}h1{color:#f6ad6c}</style><h1>Your ${safeTitle}</h1><p>Thank you for your purchase. Download any or all of your three PDF files.</p><a class="file" href="/api/file/a4">Download A4 model PDF</a><a class="file" href="/api/file/us">Download US Letter model PDF</a><a class="file" href="/api/file/guide">Download How-To PDF</a><small>Access is valid for seven days in this browser. Save your files after downloading.</small><p><a style="color:#f6ad6c" href="/">Back to website</a></p></html>`);
  }
  if(path.startsWith('/api/'))return json({error:'not found'},404);
  return env.ASSETS.fetch(req);
}
export default {async fetch(req,env){try{return await handle(req,env)}catch(err){console.error('Worker error',err?.message);return json({error:'internal error'},500)}}};
