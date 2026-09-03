// Programmatic Tinylytics events for the app surfaces. The embed script only
// binds declarative data-tinylytics-event clicks, so imperative app events go
// straight to the same collector endpoint the embed uses. sendBeacon is
// queued by the browser across navigation, so events fired just before an
// auth redirect still land; flush() stays a no-op for the same reason.
const tinylyticsSiteId = typeof __THINGY_TINYLYTICS_ID__ === 'string' ? __THINGY_TINYLYTICS_ID__ : '';
const collectorUrl = tinylyticsSiteId ? `https://tinylytics.app/collector/${tinylyticsSiteId}` : '';

function trackingBlocked() {
  try {
    if (['localhost', '127.0.0.1', '::1'].includes(window.location.hostname)) return true;
    if (window.localStorage.getItem('tinylytics_ignore') != null) return true;
  } catch (error) {
    // Storage access denied: honor the embed's behavior and stay quiet.
    return true;
  }
  return false;
}

function trackEvent(name: string, value = '') {
  // The collector requires a dotted event name; mirror the embed's guard.
  if (!collectorUrl || !name.includes('.')) return;
  if (trackingBlocked()) return;
  try {
    const hostname = `${window.location.protocol}//${window.location.hostname}`;
    const referrer = document.referrer.indexOf(hostname) < 0 ? encodeURIComponent(document.referrer) : '';
    const url =
      `${collectorUrl}?url=${encodeURIComponent(window.location.href)}` +
      `&path=${window.location.pathname}&referrer=${referrer}` +
      `&event=${encodeURIComponent(name)}&event_value=${encodeURIComponent(value)}`;
    if (!('sendBeacon' in navigator) || !navigator.sendBeacon(url)) {
      void fetch(url, { method: 'post', keepalive: true }).catch(() => {});
    }
  } catch (error) {
    // Analytics must never break the app.
  }
}

// The app has no console logging and several fire-and-forget void promises;
// without this, a render crash or rejected background promise vanishes
// entirely. Only the error's constructor name is reported - never message
// text, which can echo what the reader typed.
function registerClientErrorTracking(surface: string) {
  window.addEventListener('error', (event) => {
    const name = event.error instanceof Error ? event.error.constructor.name : 'Error';
    trackEvent('librarian.client_error', `${surface}.${name}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const name = event.reason instanceof Error ? event.reason.constructor.name : 'rejection';
    trackEvent('librarian.client_error', `${surface}.${name}`);
  });
}

export { registerClientErrorTracking, trackEvent };
