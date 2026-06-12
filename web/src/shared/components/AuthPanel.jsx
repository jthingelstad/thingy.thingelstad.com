import { render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { authAction, authBusy, authEmail, authEmailError, authMessage } from '../stores/chat-store.js';

function AuthPanel({ onSubmit, onAddSubscriber, onResendConfirmation, onEmailInput }) {
  const inputRef = useRef(null);

  // Expose the input ref for focus calls coming from chat.js.
  useEffect(() => {
    AuthPanel._inputRef = inputRef;
    return () => {
      if (AuthPanel._inputRef === inputRef) AuthPanel._inputRef = null;
    };
  }, []);

  const action = authAction.value;
  const busy = authBusy.value;
  const error = authEmailError.value;
  const message = authMessage.value;
  const email = authEmail.value;

  function handleInput(event) {
    authEmail.value = event.currentTarget.value;
    if (typeof onEmailInput === 'function') onEmailInput(event);
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (typeof onSubmit === 'function') onSubmit();
  }

  return (
    <form class="librarian-form" id="librarian-auth-form" onSubmit={handleSubmit}>
      <span class="thingy-auth-mark" aria-hidden="true">
        <img src="/img/thingy.png" alt="" width="1022" height="1022" loading="eager" />
      </span>
      <div class="thingy-auth-content">
        <p class="thingy-auth-kicker">Weekly Thing subscriber access</p>
        <h1 class="thingy-auth-title">Sign in to Thingy</h1>
        <p class="thingy-auth-copy">
          Thingy is available to Weekly Thing readers. Enter your email and I will send a private sign-in link if you
          are already subscribed, or help add you to The Weekly Thing right here if you are new.
        </p>
        <label for="librarian-email">Email address</label>
        <div class="librarian-auth-row">
          <input
            id="librarian-email"
            ref={inputRef}
            name="email"
            type="email"
            autoComplete="email"
            required
            class={`subscribe-input${error ? ' invalid' : ''}`}
            placeholder="you@example.com"
            value={email}
            onInput={handleInput}
          />
          <button
            type="submit"
            id="librarian-auth-submit"
            disabled={busy || Boolean(error)}
            data-tinylytics-event="librarian.auth_submit"
          >
            Send link
          </button>
        </div>
        <span class="subscribe-error librarian-email-error" aria-live="polite">
          {error}
        </span>
        <p class="form-message" aria-live="polite">
          {message}
        </p>
        <div class="librarian-auth-actions" hidden={action === 'none'}>
          <button
            type="button"
            id="librarian-add-subscriber"
            hidden={action !== 'subscribe'}
            disabled={busy}
            onClick={onAddSubscriber}
          >
            Add me
          </button>
          <button
            type="button"
            id="librarian-resend-confirmation"
            hidden={action !== 'resend_confirmation'}
            disabled={busy}
            onClick={onResendConfirmation}
          >
            Resend confirmation email
          </button>
        </div>
        <p class="form-note">
          Supporting Members and free subscribers can both use Thingy. Not subscribed yet? Use the same email box and I
          will offer to add you.
        </p>
      </div>
    </form>
  );
}

function mountAuthPanel(host, props = {}) {
  if (!host) return () => {};
  render(<AuthPanel {...props} />, host);
  return () => render(null, host);
}

function focusAuthEmail() {
  const ref = AuthPanel._inputRef;
  if (ref && ref.current) ref.current.focus();
}

export { AuthPanel, focusAuthEmail, mountAuthPanel };
