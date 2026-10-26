
(function () {
  'use strict';
  const MEASUREMENT_ID = 'G-W4KFL9BGH0';
  const KEY = 'postapo_analytics_consent_v1';
  const banner = document.getElementById('cookie-banner');
  const settings = document.getElementById('cookie-settings');
  const toggle = document.getElementById('analytics-opt-in');
  let analyticsLoaded = false;
  let consent = null;
  try { const saved = localStorage.getItem(KEY); if (saved === 'granted' || saved === 'denied') consent = saved; } catch (_) {}
  // Consent Mode v2: denied until visitor makes an affirmative choice.
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  gtag('consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
  function loadAnalytics() {
    if (analyticsLoaded) return;
    analyticsLoaded = true;
    gtag('js', new Date());
    gtag('config', MEASUREMENT_ID, { send_page_view: true });
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(MEASUREMENT_ID);
    document.head.appendChild(script);
  }
  function setChoice(allowed) {
    consent = allowed ? 'granted' : 'denied';
    try { localStorage.setItem(KEY, consent); } catch (_) {}
    gtag('consent', 'update', { analytics_storage: consent, ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' });
    if (allowed) loadAnalytics();
    else if (analyticsLoaded) { // Revoke optional GA cookies on this origin where accessible.
      document.cookie.split(';').forEach(function (entry) {
        const name = entry.trim().split('=')[0];
        if (/^_ga(?:_|$)|^_gid$/.test(name)) document.cookie = name + '=; Max-Age=0; Path=/; SameSite=Lax';
      });
    }
    banner.hidden = true;
    settings.hidden = true;
  }
  document.getElementById('cookie-accept').addEventListener('click', () => setChoice(true));
  document.getElementById('cookie-reject').addEventListener('click', () => setChoice(false));
  document.getElementById('cookie-customize').addEventListener('click', () => { banner.hidden = true; toggle.checked = false; settings.hidden = false; });
  document.getElementById('open-cookie-settings').addEventListener('click', () => { toggle.checked = consent === 'granted'; banner.hidden = true; settings.hidden = false; });
  document.getElementById('cookie-save').addEventListener('click', () => setChoice(toggle.checked));
  document.getElementById('cookie-cancel').addEventListener('click', () => { settings.hidden = true; if (!consent) banner.hidden = false; });
  if (consent === 'granted') { gtag('consent', 'update', { analytics_storage: 'granted' }); loadAnalytics(); }
  else if (!consent) banner.hidden = false;
  // Category navigation: record only after consent, no invented conversions.
  document.querySelectorAll('nav a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function () {
      if (consent === 'granted' && analyticsLoaded) gtag('event', 'category_navigation', { category_anchor: link.getAttribute('href').slice(1) });
    });
  });
})();
