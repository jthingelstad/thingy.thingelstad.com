// Authenticated routes intentionally do not execute the Tinylytics runtime.
// Keep the action layer's telemetry seam stable while making those calls a
// no-op; the public homepage still uses Tinylytics' declarative data hooks.
function createTinylyticsTracker(_options: { enabled?: boolean } = {}) {
  return {
    flush: () => {},
    track: (_name: string, _value?: string) => {}
  };
}

export { createTinylyticsTracker };
