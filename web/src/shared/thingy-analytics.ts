// @ts-check
interface TinylyticsEvent {
  name: string;
  value?: string;
}

function createTinylyticsTracker(options: { enabled?: boolean } = {}) {
  const enabled = Boolean(options.enabled);
  const sink = document.createElement('button');
  const pending: TinylyticsEvent[] = [];
  let ready = false;

  sink.type = 'button';
  sink.hidden = true;
  sink.setAttribute('aria-hidden', 'true');
  document.body.appendChild(sink);

  function send(name: string, value?: string) {
    if (!enabled || !name) return;
    sink.setAttribute('data-tinylytics-event', name);
    if (value) {
      sink.setAttribute('data-tinylytics-event-value', value);
    } else {
      sink.removeAttribute('data-tinylytics-event-value');
    }
    sink.click();
  }

  function flush() {
    ready = true;
    while (pending.length) {
      const event = pending.shift();
      if (event) send(event.name, event.value);
    }
  }

  function track(name: string, value?: string) {
    if (!enabled || !name) return;
    if (!ready) {
      pending.push({ name, value });
      return;
    }
    send(name, value);
  }

  window.addEventListener('tinylytics:loaded', flush, { once: true });

  return {
    flush,
    track
  };
}

export { createTinylyticsTracker };
