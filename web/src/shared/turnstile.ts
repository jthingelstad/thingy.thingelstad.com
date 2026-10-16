// Cloudflare Turnstile for the sign-in page's email actions (check,
// subscribe, resend). Bots were typing real people's addresses into the
// Librarian's email flows so our mail landed in their inboxes; the Librarian
// now checks a Turnstile token on those actions (librarian-thing
// apps/librarian/lambda/shared/turnstile.mts).
//
// Cloudflare's script loads only once someone starts typing, never on a
// plain visit. Most people see nothing (interaction-only); a doubtful
// browser gets a checkbox under the form. If the script cannot load the
// request goes ahead without a token and the Librarian decides.
//
// A click waits at most MAX_WAIT_MS for a token. The wait once stretched to
// two minutes whenever the widget asked for a checkbox, so a reader who
// missed it sat on a busy button and gave up. In observe mode the Librarian
// lets a tokenless request through, so the request goes ahead without one
// after the bound; once a wait has timed out, later clicks do not wait again
// until the widget delivers a token.
//
// A token is single-use at Cloudflare, but the Librarian keeps its verdict
// for five minutes and three uses, bound to the first address it was sent
// with, so one token covers check then subscribe. A new address, a fourth
// use or an old token gets a fresh one.
import { useRef } from 'react';

// Widget "thingelstad.com sign-in and subscribe"; the site key is public.
const SITE_KEY = '0x4AAAAAAFWqGqZVkNAWfIQn';
const TURNSTILE_SCRIPT =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=thingyTurnstileLoaded';
export const MAX_WAIT_MS = 3000;
const MAX_USES = 3;
const MAX_AGE_MS = 270000;

let loading: Promise<ThingyTurnstileApi> | null = null;

function loadTurnstile(): Promise<ThingyTurnstileApi> {
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    if (window.turnstile) return resolve(window.turnstile);
    window.thingyTurnstileLoaded = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('turnstile-unavailable'));
    };
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('turnstile-unavailable'));
    document.head.appendChild(script);
  });
  return loading;
}

interface TurnstileHandle {
  warm(): void;
  tokenFor(email: string): Promise<string>;
  reset(): void;
}

function attachTurnstile(slot: () => HTMLElement | null, action: string): TurnstileHandle {
  let widgetId: string | null = null;
  let token = '';
  let issuedAt = 0;
  let uses = 0;
  let boundEmail = '';
  let timedOut = false;
  let unavailable = false;
  let waiters: Array<() => void> = [];

  function settle() {
    const pending = waiters;
    waiters = [];
    for (const wake of pending) wake();
  }

  function warm() {
    const container = slot();
    if (widgetId !== null || unavailable || !container) return;
    widgetId = 'pending';
    loadTurnstile().then(
      (api) => {
        widgetId = api.render(container, {
          sitekey: SITE_KEY,
          action,
          appearance: 'interaction-only',
          'refresh-expired': 'auto',
          callback: (value: string) => {
            token = value;
            issuedAt = Date.now();
            uses = 0;
            boundEmail = '';
            timedOut = false;
            settle();
          },
          'expired-callback': () => {
            token = '';
          },
          'error-callback': () => {
            token = '';
            settle();
          }
        });
      },
      () => {
        unavailable = true;
        widgetId = null;
        settle();
      }
    );
  }

  function reset() {
    token = '';
    uses = 0;
    boundEmail = '';
    if (window.turnstile && widgetId !== null && widgetId !== 'pending') {
      try {
        window.turnstile.reset(widgetId);
      } catch {
        // A widget that is already gone renders afresh on the next warm().
      }
    }
  }

  function fresh(email: string) {
    if (!token) return false;
    if (uses >= MAX_USES || Date.now() - issuedAt > MAX_AGE_MS) return false;
    return !boundEmail || boundEmail === email;
  }

  // Resolves to a token for this address, or '' when none came in time.
  function tokenFor(rawEmail: string): Promise<string> {
    const email = String(rawEmail || '')
      .trim()
      .toLowerCase();
    warm();
    if (token && !fresh(email)) reset();
    return new Promise((resolve) => {
      const started = Date.now();
      const limit = timedOut ? 0 : MAX_WAIT_MS;
      const finish = () => {
        if (!token) return resolve('');
        uses += 1;
        boundEmail = email;
        resolve(token);
      };
      const poll = () => {
        if (token || unavailable) return finish();
        const left = limit - (Date.now() - started);
        if (left <= 0) {
          timedOut = true;
          return finish();
        }
        const wake = () => {
          window.clearTimeout(timer);
          poll();
        };
        const timer = window.setTimeout(
          () => {
            waiters = waiters.filter((fn) => fn !== wake);
            poll();
          },
          Math.min(250, left)
        );
        waiters.push(wake);
      };
      poll();
    });
  }

  return { warm, tokenFor, reset };
}

// Exported for tests; components use useTurnstile.
export { attachTurnstile };

// One widget per component, rendered into the element the ref points at.
export function useTurnstile(action: string) {
  const slotRef = useRef<HTMLDivElement | null>(null);
  const handle = useRef<TurnstileHandle | null>(null);
  if (!handle.current) handle.current = attachTurnstile(() => slotRef.current, action);
  return { slotRef, turnstile: handle.current };
}
