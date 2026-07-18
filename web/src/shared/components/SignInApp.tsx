import { render, type JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import * as session from '../thingy-session.ts';
import { errorMessage } from '../thingy-errors.ts';

type SecondaryAction = '' | 'subscribe' | 'resend';

function SignInApp() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const loginToken = String(params.get('login_token') || params.get('magic_token') || '').trim();
  const returnTo = session.returnPath('/chat/');
  const [email, setEmail] = useState(session.storedEmail());
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState('');
  const [secondary, setSecondary] = useState<SecondaryAction>('');
  const [busy, setBusy] = useState(false);

  function destinationPath() {
    if (!returnTo || returnTo === '/signin/' || returnTo.startsWith('/signin/?')) return '/chat/';
    return session.restorePendingReturnParams(returnTo);
  }

  function finish(data: ThingyAuthData, address: unknown) {
    session.persistAuth(data, session.normalizeEmail(address));
    window.location.replace(destinationPath());
  }

  function scrubMagicTokenParams() {
    params.delete('login_token');
    params.delete('magic_token');
    window.history.replaceState(
      window.history.state,
      document.title,
      `${window.location.pathname}?${params.toString()}`.replace(/\?$/, '')
    );
  }

  useEffect(() => {
    async function bootstrap() {
      if (session.token() && !session.tokenExpired() && !loginToken) {
        setMessage('You are already signed in.');
        setMessageKind('success');
        window.location.replace(destinationPath());
        return;
      }
      if (!loginToken) return;
      setBusy(true);
      setMessage('Signing you in...');
      setMessageKind('pending');
      try {
        const data = await session.postJson(
          '/auth',
          { action: 'complete_magic_link', login_token: loginToken, source: 'thingy' },
          {}
        );
        if (!data.token) throw new Error(data.message || 'That sign-in link did not return a session.');
        scrubMagicTokenParams();
        finish(data, data.email);
      } catch (error) {
        scrubMagicTokenParams();
        setMessage(errorMessage(error, 'That sign-in link did not work.'));
        setMessageKind('error');
        session.clearAuth();
      } finally {
        setBusy(false);
      }
    }
    void bootstrap();
    // Magic-link completion is a single route bootstrap operation.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function requestMagicLink(action = 'check') {
    const address = session.normalizeEmail(email);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
      setMessage('Enter a valid email address.');
      setMessageKind('error');
      return;
    }
    setBusy(true);
    setSecondary('');
    setMessage(action === 'subscribe' ? 'Adding you to The Weekly Thing...' : 'Checking your access...');
    setMessageKind('pending');
    try {
      const data = await session.postJson(
        '/auth',
        { action, email: address, source: 'thingy', return_path: returnTo },
        {}
      );
      if (data.token) {
        finish(data, address);
        return;
      }
      if (data.status === 'magic_link_sent') {
        setMessage('Check your email for a private sign-in link from Thingy.');
        setMessageKind('success');
        window.localStorage.setItem(session.userEmailKey, address);
      } else if (data.status === 'not_found') {
        setMessage('That email is not subscribed yet. Thingy can help add you to The Weekly Thing.');
        setMessageKind('notice');
        setSecondary('subscribe');
      } else if (data.status === 'unconfirmed') {
        setMessage('Please confirm your Weekly Thing subscription first.');
        setMessageKind('notice');
        setSecondary('resend');
      } else if (data.status === 'subscribed') {
        setMessage('Check your inbox to confirm your subscription, then come back to sign in.');
        setMessageKind('success');
      } else {
        setMessage(data.message || 'Check your email for the next step.');
        setMessageKind('notice');
      }
    } catch (error) {
      setMessage(errorMessage(error, 'Sign-in is unavailable right now.'));
      setMessageKind('error');
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: JSX.TargetedSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    void requestMagicLink('check');
  }

  return (
    <section class="thingy-auth-page">
      <div class="thingy-auth-card">
        <span class="thingy-auth-mark" aria-hidden="true">
          <img src="/img/thingy.png" alt="" width="1022" height="1022" loading="eager" />
        </span>
        <div class="thingy-auth-content">
          <p class="thingy-auth-kicker">Thingy access</p>
          <h1 class="thingy-auth-title">Sign in to Thingy</h1>
          <p class="thingy-auth-copy">
            Enter your email address and Thingy will send a private sign-in link. Weekly Thing readers can use Chat, and
            supporting members get the deeper features.
          </p>
          <form class="thingy-signin-form" onSubmit={handleSubmit}>
            <label for="thingy-signin-email">Email address</label>
            <div class="thingy-signin-row">
              <input
                id="thingy-signin-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                placeholder="you@example.com"
                value={email}
                onInput={(event) => setEmail(event.currentTarget.value)}
              />
              <button type="submit" disabled={busy}>
                Send Link
              </button>
            </div>
          </form>
          <p class="thingy-signin-message" data-kind={messageKind} aria-live="polite">
            {message}
          </p>
          <div class="thingy-signin-secondary" hidden={!secondary}>
            {secondary === 'subscribe' ? (
              <button type="button" disabled={busy} onClick={() => void requestMagicLink('subscribe')}>
                Add Me to The Weekly Thing
              </button>
            ) : null}
            {secondary === 'resend' ? (
              <button type="button" disabled={busy} onClick={() => void requestMagicLink('resend_confirmation')}>
                Resend Confirmation
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function mountSignInApp(host: HTMLElement | null) {
  if (host) render(<SignInApp />, host);
}

export { mountSignInApp };
