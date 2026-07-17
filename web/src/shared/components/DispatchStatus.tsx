import { render } from 'preact';
import { dispatchStatusKind, dispatchStatusMessage } from '../stores/dispatch-store.ts';

function DispatchStatus() {
  const message = dispatchStatusMessage.value;
  const kind = dispatchStatusKind.value;
  return (
    <p class="dispatch-status" data-kind={kind || undefined} aria-live="polite">
      {message}
    </p>
  );
}

function mountDispatchStatus(host) {
  if (!host) return () => {};
  render(<DispatchStatus />, host);
  return () => render(null, host);
}

export { DispatchStatus, mountDispatchStatus };
