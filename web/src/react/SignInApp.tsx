import { useEffect, useMemo, useState, type FormEvent } from 'react';
import * as session from '../shared/thingy-session.ts';
import { errorMessage } from '../shared/thingy-errors.ts';
import { runningStandalone, trackEvent } from '../shared/thingy-analytics.ts';
import { ThingyFace } from './components/ThingyFace.tsx';

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
  // Installed app: the emailed magic link opens the browser's separate
  // cookie jar, so the code is the path that signs THIS context in.
  const standalone = useMemo(() => runningStandalone(), []);

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
      trackEvent('librarian.signin_visit', loginToken ? 'magic_link' : session.sessionActive() ? 'active' : 'form');
      if (session.sessionActive() && !loginToken) {
        setMessage("You're already in.");
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
    setMessage(action === 'subscribe' ? 'Adding you to The Weekly Thing...' : 'Checking the subscriber list...');
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
        setMessage(
          standalone
            ? 'Check your inbox - Thingy just wrote to you. Enter the six-digit code below (the emailed link opens in your browser, not this app).'
            : 'Check your inbox - Thingy just wrote to you. Enter the six-digit code below, or use the link.'
        );
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

  const mood = busy ? 'thinking' : messageKind === 'error' ? 'oops' : 'idle';
  // "Check your inbox!" is the mascot's aside once a code is on its way;
  // the status line below carries the real message.
  const inboxBubble = codeEntry && messageKind === 'success';

  return (
    <main className="thingy-auth-page flex min-h-dvh flex-col bg-bg font-sans text-ink">
      <header className="mx-auto flex h-[60px] w-full max-w-[1200px] items-center px-4 md:h-auto md:px-8 md:py-6">
        <a
          className="inline-flex min-h-11 items-center gap-2.5 text-ink no-underline md:gap-3"
          href="/"
          aria-label="Thingy home"
        >
          <ThingyFace mood={mood} size={44} />
          <span className="thingy-display text-[24px] leading-none md:text-[27px]">Thingy</span>
        </a>
      </header>
      <div className="flex flex-1 flex-col items-center px-4 pb-6 md:px-6 md:pt-[150px] md:pb-14">
        <div className="relative w-full max-w-[600px]">
          <div
            className="relative mt-2 flex h-[118px] justify-center md:absolute md:top-[-168px] md:left-1/2 md:mt-0 md:-ml-[110px] md:h-[220px] md:w-[220px]"
            aria-hidden="true"
          >
            <img
              className="size-[136px] select-none md:size-[220px]"
              src="/img/thingy.png"
              alt=""
              width="1022"
              height="1022"
              loading="eager"
              draggable={false}
            />
          </div>
          {inboxBubble ? (
            <span
              className="absolute top-[18px] right-[calc(50%+36px)] z-[2] -rotate-3 rounded-[16px_16px_5px_16px] border-2 border-ink bg-paper px-3 py-[7px] text-[14px] font-extrabold whitespace-nowrap shadow-[3px_3px_0_var(--thingy-ink)] md:top-[-150px] md:right-auto md:left-[calc(50%+96px)] md:rotate-3 md:rounded-[20px_20px_20px_6px] md:px-[18px] md:py-3 md:text-[17px] md:shadow-[4px_4px_0_var(--thingy-ink)]"
              aria-hidden="true"
            >
              Check your inbox!
            </span>
          ) : null}
          <section
            className="relative z-[1] flex flex-col gap-4 rounded-[22px] border-2 border-ink bg-paper px-5 py-[22px] shadow-[0_6px_0_var(--thingy-ink)] md:gap-5 md:rounded-[24px] md:px-11 md:pt-10 md:pb-9"
            aria-labelledby="thingy-signin-title"
          >
            <div className="flex flex-col gap-1.5 md:gap-2.5">
              <p className="font-mono text-[12px] font-semibold tracking-[0.16em] text-meta uppercase md:text-[13px]">
                Come on in
              </p>
              <h1
                className="thingy-display text-[34px] leading-[1.02] tracking-[-0.025em] md:text-[46px] md:leading-none"
                id="thingy-signin-title"
              >
                Sign in to Thingy
              </h1>
              <p className="mt-1 text-[16px] leading-normal text-[#3d4654] md:text-[17px] md:leading-[1.55]">
                {standalone
                  ? 'Enter your email address and Thingy will email you a six-digit sign-in code. Weekly Thing readers can use Chat, and supporting members get the deeper features.'
                  : 'Enter your email address and Thingy will send a private sign-in link. Weekly Thing readers can use Chat, and supporting members get the deeper features.'}
              </p>
            </div>
            <form className="thingy-signin-form flex flex-col gap-2" onSubmit={handleSubmit}>
              <label className="thingy-field-label mb-0" htmlFor="thingy-signin-email">
                Email address
              </label>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <input
                  className="thingy-input min-h-[52px] min-w-0 flex-1 rounded-[14px] px-4"
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
                <button type="submit" className="thingy-btn thingy-btn-primary min-h-[52px] shrink-0" disabled={busy}>
                  Email Me a Code
                </button>
              </div>
            </form>
            <div className="empty:sr-only" data-kind={messageKind} aria-live="polite">
              {message ? <SignInStatus kind={messageKind} text={message} /> : null}
            </div>
            {codeEntry ? (
              <form
                className="thingy-signin-form thingy-signin-code flex flex-col gap-2.5 border-t-2 border-dashed border-rule pt-[18px]"
                onSubmit={submitCode}
              >
                <label className="thingy-field-label mb-0" htmlFor="thingy-signin-code">
                  Sign-in code
                </label>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <input
                    className="thingy-input min-h-[52px] min-w-0 flex-1 rounded-[14px] px-4 font-mono text-[20px] font-semibold tracking-[0.2em] placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:tracking-normal"
                    id="thingy-signin-code"
                    name="one-time-code"
                    type="text"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    placeholder="123456"
                    autoFocus
                    value={code}
                    onChange={(event) => setCode(event.currentTarget.value)}
                  />
                  <button
                    type="submit"
                    className="thingy-btn thingy-btn-primary min-h-[52px] shrink-0 px-[30px]"
                    disabled={busy || code.replace(/[^0-9]/g, '').length !== 6}
                  >
                    Sign In
                  </button>
                </div>
              </form>
            ) : null}
            <div className="flex flex-wrap gap-3" hidden={!secondary}>
              {secondary === 'subscribe' ? (
                <button
                  type="button"
                  className="thingy-btn thingy-btn-secondary"
                  disabled={busy}
                  onClick={() => void requestMagicLink('subscribe')}
                >
                  Add Me to The Weekly Thing
                </button>
              ) : null}
              {secondary === 'resend' ? (
                <button
                  type="button"
                  className="thingy-btn thingy-btn-secondary"
                  disabled={busy}
                  onClick={() => void requestMagicLink('resend_confirmation')}
                >
                  Resend Confirmation
                </button>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

// The status line in its four real kinds: error (danger box), success
// (mint box with a tick), pending (the three thinking dots) and notice
// (paper with a clay edge).
function SignInStatus({ kind, text }: { kind: string; text: string }) {
  if (kind === 'pending') {
    return (
      <p className="flex items-center gap-3 px-1 py-3 text-[15px] leading-[1.45] font-semibold text-[#3d4654]">
        <span className="thingy-dots inline-flex shrink-0 gap-[5px]" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span>{text}</span>
      </p>
    );
  }
  if (kind === 'notice') {
    return (
      <p className="rounded-[6px_14px_14px_6px] border-[1.5px] border-l-[6px] border-rule border-l-clay bg-paper py-3 pr-4 pl-[18px] text-[15px] leading-[1.45] font-semibold text-ink">
        {text}
      </p>
    );
  }
  const error = kind === 'error';
  return (
    <p
      className={`flex items-start gap-2.5 rounded-[14px] border-2 px-4 py-3 text-[15px] leading-[1.45] font-semibold ${
        error ? 'border-danger bg-danger-tint text-danger' : 'border-[#2e6b34] bg-[#e3f6e0] text-[#2e6b34]'
      }`}
    >
      <svg
        className="mt-px size-5 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={error ? 2.2 : 2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {error ? (
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v6" />
            <path d="M12 16.5v.5" />
          </>
        ) : (
          <path d="m5 12.5 4.5 4.5L19 7.5" />
        )}
      </svg>
      <span>{text}</span>
    </p>
  );
}
