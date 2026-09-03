import { useEffect, useMemo, useState, type FormEvent } from 'react';
import * as session from '../shared/thingy-session.ts';
import { errorMessage } from '../shared/thingy-errors.ts';
import { trackEvent } from '../shared/thingy-analytics.ts';

type SecondaryAction = '' | 'subscribe' | 'resend';

export function SignInApp({
  initialLoginToken = '',
  initialEmail = ''
}: {
  initialLoginToken?: string;
  initialEmail?: string;
}) {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const loginToken = initialLoginToken;
  const returnTo = session.returnPath('/chat/');
  const [email, setEmail] = useState(initialEmail || session.storedEmail());
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState('');
  const [secondary, setSecondary] = useState<SecondaryAction>('');
  const [busy, setBusy] = useState(false);
  const [codeEntry, setCodeEntry] = useState(false);
  const [code, setCode] = useState('');

  function destinationPath() {
    if (!returnTo || returnTo === '/signin/' || returnTo.startsWith('/signin/?')) return '/chat/';
    return session.restorePendingReturnParams(returnTo);
  }

  function finish(data: ThingyAuthData, address: unknown, method: string) {
    // sendBeacon is queued across the navigation, so this lands despite the
    // immediate redirect.
    trackEvent('librarian.signin_success', method);
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
      // The Tinylytics embed deliberately skips /signin (privacy: magic
      // tokens ride the URL), so this event is the page's only visit signal.
      trackEvent(
        'librarian.signin_visit',
        loginToken ? 'magic_link' : session.sessionActive() ? 'active' : 'form'
      );
      if (session.sessionActive() && !loginToken) {
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
        finish(data, data.email, 'magic_link');
      } catch (error) {
        scrubMagicTokenParams();
        trackEvent('librarian.signin_error', 'magic_link');
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
        finish(data, address, 'direct');
        return;
      }
      if (data.status === 'magic_link_sent') {
        trackEvent('librarian.signin_request', 'ok');
        setMessage('Check your email - enter the sign-in code below, or use the link.');
        setMessageKind('success');
        setCodeEntry(true);
        setCode('');
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
      trackEvent('librarian.signin_request', 'error');
      setMessage(errorMessage(error, 'Sign-in is unavailable right now.'));
      setMessageKind('error');
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void requestMagicLink('check');
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const digits = code.replace(/[^0-9]/g, '');
    if (digits.length !== 6) {
      setMessage('The sign-in code is six digits.');
      setMessageKind('error');
      return;
    }
    setBusy(true);
    setMessage('Checking your code...');
    setMessageKind('pending');
    try {
      const data = await session.postJson(
        '/auth',
        { action: 'verify_code', email: session.normalizeEmail(email), code: digits, source: 'thingy' },
        {}
      );
      if (!data.token) throw new Error(data.message || 'That code did not return a session.');
      finish(data, data.email || email, 'code');
    } catch (error) {
      trackEvent('librarian.signin_error', 'code');
      setMessage(errorMessage(error, 'That code did not work. Check the newest email or request a fresh link.'));
      setMessageKind('error');
      setCode('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="thingy-auth-page grid min-h-dvh place-items-center bg-bg p-5 font-sans text-ink">
      <div className="flex w-[min(34rem,100%)] flex-col items-center gap-4 rounded-3xl border border-line bg-surface p-7 shadow-[0_24px_70px_-30px_rgb(14_43_38/0.35)] sm:flex-row sm:items-start sm:gap-6">
        <span className="shrink-0" aria-hidden="true">
          <img
            className="size-20 rounded-2xl"
            src="/img/thingy.png"
            alt=""
            width="1022"
            height="1022"
            loading="eager"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold tracking-[0.14em] text-accent-deep uppercase">Thingy access</p>
          <h1 className="mt-0.5 text-[22px] leading-tight font-extrabold">Sign in to Thingy</h1>
          <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">
            Enter your email address and Thingy will send a private sign-in link. Weekly Thing readers can use Chat, and
            supporting members get the deeper features.
          </p>
          <form className="thingy-signin-form mt-4" onSubmit={handleSubmit}>
            <label className="text-[11px] font-bold tracking-wider text-muted uppercase" htmlFor="thingy-signin-email">
              Email address
            </label>
            <div className="mt-1 flex gap-2">
              <input
                className="w-full min-w-0 rounded-xl border border-line bg-bg px-3.5 py-2.5 text-[15px] text-ink outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent-soft"
                id="thingy-signin-email"
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.currentTarget.value)}
              />
              <button
                type="submit"
                className="shrink-0 rounded-xl bg-accent-deep px-4 py-2.5 text-[14px] font-bold text-bg hover:brightness-110 disabled:opacity-50"
                disabled={busy}
              >
                Send Link
              </button>
            </div>
          </form>
          <p
            className={`mt-2.5 min-h-5 text-[13.5px] ${messageKind === 'error' ? 'text-error' : messageKind === 'success' ? 'text-accent-deep' : 'text-ink-soft'}`}
            data-kind={messageKind}
            aria-live="polite"
          >
            {message}
          </p>
          {codeEntry ? (
            <form className="thingy-signin-form thingy-signin-code mt-3" onSubmit={submitCode}>
              <label className="text-[11px] font-bold tracking-wider text-muted uppercase" htmlFor="thingy-signin-code">
                Sign-in code
              </label>
              <div className="mt-1 flex gap-2">
                <input
                  className="w-full min-w-0 rounded-xl border border-line bg-bg px-3.5 py-2.5 font-mono text-[15px] tracking-[0.2em] text-ink outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent-soft"
                  id="thingy-signin-code"
                  name="one-time-code"
                  type="text"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="123456"
                  value={code}
                  onChange={(event) => setCode(event.currentTarget.value)}
                />
                <button
                  type="submit"
                  className="shrink-0 rounded-xl bg-accent-deep px-4 py-2.5 text-[14px] font-bold text-bg hover:brightness-110 disabled:opacity-50"
                  disabled={busy || code.replace(/[^0-9]/g, '').length !== 6}
                >
                  Sign In
                </button>
              </div>
            </form>
          ) : null}
          <div className="mt-2 flex gap-2" hidden={!secondary}>
            {secondary === 'subscribe' ? (
              <button
                type="button"
                className="rounded-xl border border-line bg-surface px-3.5 py-2 text-[13.5px] font-bold text-ink hover:border-accent hover:bg-accent-soft disabled:opacity-50"
                disabled={busy}
                onClick={() => void requestMagicLink('subscribe')}
              >
                Add Me to The Weekly Thing
              </button>
            ) : null}
            {secondary === 'resend' ? (
              <button
                type="button"
                className="rounded-xl border border-line bg-surface px-3.5 py-2 text-[13.5px] font-bold text-ink hover:border-accent hover:bg-accent-soft disabled:opacity-50"
                disabled={busy}
                onClick={() => void requestMagicLink('resend_confirmation')}
              >
                Resend Confirmation
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}
