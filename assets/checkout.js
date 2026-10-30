/* Post-Apo checkout: keep production purchase buttons OFF until full delivery testing. */
(() => {
  'use strict';
  const CHECKOUT_ENABLED = true;
  const CLIENT_TOKEN = 'live_2980fd5ee59e380d298507a6e18';
  const PADDLE_SCRIPT = 'https://cdn.paddle.com/paddle/v2/paddle.js';
  let buttons = document.querySelectorAll('[data-buy-product]');
  buttons = Array.from(buttons);
  let ready;
  const loadPaddle = () => ready ||= new Promise((resolve, reject) => {
    if (window.Paddle) return resolve(window.Paddle);
    const s = document.createElement('script');
    s.src = PADDLE_SCRIPT;
    s.async = true;
    s.onload = () => window.Paddle ? resolve(window.Paddle) : reject(new Error('Paddle unavailable'));
    s.onerror = () => reject(new Error('Unable to load checkout'));
    document.head.appendChild(s);
  });
  const message = (text) => {
    const el = document.getElementById('checkout-message');
    if (el) { el.textContent = text; el.hidden = false; }
    else alert(text);
  };
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  let claimInProgress = false;
  async function claimWithRetry(transactionId) {
    if (claimInProgress) return;
    claimInProgress = true;
    const deadline = Date.now() + 30000;
    message('Payment received. Verifying your purchase, please wait…');
    try {
      while (true) {
        let response;
        try {
          response = await fetch('/api/claim', {
            method: 'POST', credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transactionId })
          });
        } catch (_) {
          if (Date.now() >= deadline) break;
          await wait(2000);
          continue;
        }
        if (response.ok) {
          const data = await response.json();
          window.location.assign(data.downloadPage || '/downloads');
          return;
        }
        // Only pending processing (409) and temporary server/API failures (503/502/504)
        // are retryable. A 403 is a permanent eligibility failure, not a pending payment.
        if (![409, 502, 503, 504].includes(response.status)) break;
        if (Date.now() >= deadline) break;
        await wait(Math.min(2000, Math.max(0, deadline - Date.now())));
      }
      message('Your payment may be complete, but download verification is not ready. Please contact us with your Paddle receipt. Do not pay again.');
    } finally { claimInProgress = false; }
  }
  const track=(event,product)=>{if(window.postapoAnalyticsAllowed?.()&&typeof window.gtag==='function')window.gtag('event',event,{item_name:product==='deluxe'?'Gas Station Deluxe':'Gas Station Box',currency:'USD',value:product==='deluxe'?5.45:4.75});};
  async function initPaddle(){
    const Paddle=await loadPaddle();
    if (!window.__postapoPaddleInit) {
          Paddle.Initialize({ token: CLIENT_TOKEN, eventCallback: async event => {
            if (event.name !== 'checkout.completed') return;
            const txnId = event.data?.transaction_id || event.data?.transaction?.id;
            if (!txnId) {
              message('Payment received. Please contact support with your receipt. Do not pay again.');
              return;
            }
            await claimWithRetry(txnId);
          }});
          window.__postapoPaddleInit = true;
        }
    return Paddle;
  }
  const recovered=new URLSearchParams(location.search).get('_ptxn');
  const currentProduct=location.pathname.includes('deluxe')?'deluxe':location.pathname.includes('gas-station-box')?'box':null;
  if(/^txn_[a-z0-9]{10,80}$/.test(recovered||'')&&currentProduct){
    (async()=>{try{
      const r=await fetch('/api/recovery-resume',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({transactionId:recovered,product:currentProduct})});
      if(!r.ok)throw Error('Unable to resume this payment. Contact support with your Paddle receipt.');
      const Paddle=await initPaddle();Paddle.Checkout.open({transactionId:recovered});
    }catch(e){message(e.message||'Unable to resume checkout');}})();
  }
  let busy = false;
  for (const button of buttons) {
    if (CHECKOUT_ENABLED) {
      button.removeAttribute('aria-disabled');
      button.textContent = button.dataset.buyProduct === 'deluxe' ? 'Buy & Download, $5.45' : 'Buy & Download, $4.75';
    }
    button.addEventListener('click', async e => {
      e.preventDefault();
      if (busy) return;
      busy = true;
      try {
        const product = button.dataset.buyProduct;
        track('select_item',product);
        const Paddle=await initPaddle();
        const recovery=await fetch('/api/recovery-start',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({product})});
        if(recovery.ok){
          const data=await recovery.json();
          if(!/^txn_[a-z0-9]{10,80}$/.test(data.transactionId||''))throw Error('Invalid transaction');
          Paddle.Checkout.open({transactionId:data.transactionId});
        }else if(recovery.status===503){
          const res=await fetch('/api/checkout-session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({product})});
          if(!res.ok)throw Error('Unable to create secure checkout session');
          const session=await res.json();
          Paddle.Checkout.open({items:[{priceId:session.priceId,quantity:1}],customData:{website:'postapocalypticpapercraft.com',product,postapo_checkout_nonce:session.checkoutNonce}});
        }else throw Error('Checkout temporarily unavailable');
        track('begin_checkout',product);
      } catch (err) { message(err.message || 'Checkout temporarily unavailable'); }
      finally { busy = false; }
    });
  }
})();
