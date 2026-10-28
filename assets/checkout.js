/* Post-Apo checkout: production buttons OFF. The query-parameter test uses REAL live Paddle payments; do not share test URL. */
(() => {
  'use strict';
  const CHECKOUT_ENABLED = false;
  const CLIENT_TOKEN = 'live_2980fd5ee59e380d298507a6e18';
  const PADDLE_SCRIPT = 'https://cdn.paddle.com/paddle/v2/paddle.js';
  let buttons = document.querySelectorAll('[data-buy-product]');
  // This URL flag is not authorization; the test checkout is publicly discoverable.
  const testMode = new URLSearchParams(location.search).get('checkout_test') === '1';
  if (!CHECKOUT_ENABLED && !testMode) return;
  if (testMode && !CHECKOUT_ENABLED) {
    const heroButton = buttons[0];
    if (!heroButton) return;
    const panel = document.createElement('div');
    panel.style.cssText = 'margin:16px 0;padding:16px;background:#34251c;border:2px solid #ffd04b;color:#fff;max-width:500px';
    const heading = document.createElement('strong');
    heading.textContent = 'PRIVATE LIVE PURCHASE TEST, GAS STATION BOX';
    const note = document.createElement('p');
    note.textContent = 'This opens a REAL $4.75 Paddle checkout. Only proceed if you intentionally want to pay and test the full download flow. After payment, keep this browser open while verification runs. Do not pay twice if delivery fails.';
    const testButton = document.createElement('button');
    testButton.type = 'button';
    testButton.className = 'cta';
    testButton.textContent = 'Open live checkout, $4.75';
    testButton.dataset.buyProduct = 'box';
    panel.append(heading, note, testButton);
    heroButton.insertAdjacentElement('afterend', panel);
    buttons = [testButton];
  }
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
        const res = await fetch('/api/checkout-session', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ product })
        });
        if (!res.ok) throw Error('Unable to create secure checkout session');
        const session = await res.json();
        const Paddle = await loadPaddle();
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
        Paddle.Checkout.open({
          items: [{ priceId: session.priceId, quantity: 1 }],
          customData: { website: 'postapocalypticpapercraft.com', product, postapo_checkout_nonce: session.checkoutNonce }
        });
      } catch (err) { message(err.message || 'Checkout temporarily unavailable'); }
      finally { busy = false; }
    });
  }
})();
