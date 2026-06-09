const tinylyticsSiteId = typeof __THINGY_TINYLYTICS_ID__ === 'string' ? __THINGY_TINYLYTICS_ID__ : '';

export function loadTinylytics() {
  if (!tinylyticsSiteId) return;
  if (['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) return;

  try {
    const url = new URL(window.location.href);
    ['email', 'prompt', 'from', 'scope', 'corpus', 'dispatch_test', 'test', 'login_token', 'magic_token'].forEach((name) => {
      url.searchParams.delete(name);
    });
    if (url.href !== window.location.href) {
      window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
    }
  } catch (error) {
    // Leave the URL alone when the browser cannot parse it.
  }

  const script = document.createElement('script');
  script.defer = true;
  script.src = `https://tinylytics.app/embed/${tinylyticsSiteId}/min.js?events&beacon`;
  script.addEventListener('load', () => {
    window.dispatchEvent(new Event('tinylytics:loaded'));
  });
  document.body.appendChild(script);
}
