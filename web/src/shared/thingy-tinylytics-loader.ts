const tinylyticsSiteId = typeof __THINGY_TINYLYTICS_ID__ === 'string' ? __THINGY_TINYLYTICS_ID__ : '';

export function loadTinylytics() {
  try {
    const url = new URL(window.location.href);
    ['email', 'prompt', 'from', 'explore', 'issue', 'scope', 'corpus', 'login_token', 'magic_token'].forEach((name) => {
      url.searchParams.delete(name);
    });
    if (url.href !== window.location.href) {
      window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
    }
  } catch (error) {
    // Leave the URL alone when the browser cannot parse it.
  }

  if (!tinylyticsSiteId) return;
  if (['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) return;
  // The sign-in page handles one-time login values; keep third-party
  // script off it entirely (audit W2). The URL scrub above still ran.
  if (window.location.pathname.startsWith('/signin')) return;

  // One tag for every site: the widgets (hits, countries) and options
  // (events, beacon) are set in the site's Tinylytics settings, not the URL.
  // Load it once per page load. The script counts pushState, replaceState
  // and popstate itself (the chat's conversation URL sync), so it must never
  // be re-injected on a route change: that would double count.
  const script = document.createElement('script');
  script.defer = true;
  script.src = 'https://tinylytics.app/js/script.js';
  script.dataset.site = tinylyticsSiteId;
  script.addEventListener('load', () => {
    window.dispatchEvent(new Event('tinylytics:loaded'));
  });
  document.body.appendChild(script);
}
