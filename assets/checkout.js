/* Paddle checkout, release gate OFF until sandbox and delivery tests pass. */
(() => {
  'use strict';
  const CHECKOUT_ENABLED = false; // Change only after complete end-to-end testing.
  const CLIENT_TOKEN = 'live_2980fd5ee59e380d298507a6e18';
  const PADDLE_SCRIPT = 'https://cdn.paddle.com/paddle/v2/paddle.js';
  const BUTTONS = document.querySelectorAll('[data-buy-product]');
  if (!CHECKOUT_ENABLED) return;
  let ready;
  const loadPaddle = () => ready ||= new Promise((resolve,reject) => {
    if (window.Paddle) return resolve(window.Paddle);
    const s=document.createElement('script');s.src=PADDLE_SCRIPT;s.async=true;
    s.onload=()=>window.Paddle?resolve(window.Paddle):reject(new Error('Paddle unavailable'));
    s.onerror=()=>reject(new Error('Unable to load checkout'));
    document.head.appendChild(s);
  });
  const message = (text) => {const el=document.getElementById('checkout-message');if(el){el.textContent=text;el.hidden=false;}else alert(text);};
  let busy=false;
  for (const button of BUTTONS) {
    button.removeAttribute('aria-disabled');
    button.textContent = button.dataset.buyProduct === 'deluxe' ? 'Buy & Download, $5.45' : 'Buy & Download, $4.75';
    button.addEventListener('click', async e => {
      e.preventDefault();if(busy)return;busy=true;
      try {
        const product=button.dataset.buyProduct;
        const res=await fetch('/api/checkout-session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({product})});
        if(!res.ok)throw Error('Unable to create secure checkout session');
        const session=await res.json();
        const Paddle=await loadPaddle();
        if(!window.__postapoPaddleInit){
          Paddle.Initialize({token:CLIENT_TOKEN,eventCallback:async event=>{
            if(event.name!=='checkout.completed')return;
            const txnId=event.data?.transaction_id || event.data?.transaction?.id;
            if(!txnId){message('Payment received. Please contact support with your receipt.');return;}
            try{
              const r=await fetch('/api/claim',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({transactionId:txnId})});
              if(!r.ok)throw Error('Verification pending');
              const data=await r.json();window.location.assign(data.downloadPage||'/downloads');
            }catch{message('Payment completed, but download verification is pending. Please contact support with your Paddle receipt.');}
          }});
          window.__postapoPaddleInit=true;
        }
        Paddle.Checkout.open({items:[{priceId:session.priceId,quantity:1}],customData:{website:'postapocalypticpapercraft.com',product,postapo_checkout_nonce:session.checkoutNonce}});
      }catch(err){message(err.message||'Checkout temporarily unavailable');}
      finally{busy=false;}
    });
  }
})();
