import { signInUrl } from '../../shared/thingy-session.ts';
import { isAuthError } from '../../shared/thingy-url.ts';
import { ThingyFace } from './ThingyFace.tsx';

// onRail: the navy chat rail, where the muted and clay tones on cream
// would fail contrast - cream text and white actions instead. On paper
// (All chats) the state carries the face: idle for "sign in again" (a
// normal moment, not a failure), oops for a load that failed, and the
// recovery is a real primary button.
export function HistoryStatus({
  error,
  retry,
  onRail = false
}: {
  error: unknown;
  retry: () => void;
  onRail?: boolean;
}) {
  const signedOut = isAuthError(error);
  const message = signedOut
    ? 'Sign in again to load your saved chats.'
    : 'Could not load your chats. Please try again.';
  if (!onRail) {
    return (
      <div
        role="alert"
        className="thingy-history-status grid justify-items-center gap-3 px-4 py-8 text-center font-sans"
      >
        <ThingyFace mood={signedOut ? 'idle' : 'oops'} size={72} animated={false} />
        <p className="max-w-[26rem] text-[15px] text-ink">{message}</p>
        {signedOut ? (
          <a className="thingy-btn thingy-btn-primary thingy-btn-compact" href={signInUrl()}>
            Sign in
          </a>
        ) : (
          <button type="button" className="thingy-btn thingy-btn-primary thingy-btn-compact" onClick={retry}>
            Try again
          </button>
        )}
      </div>
    );
  }
  const action = 'inline-flex min-h-11 items-center font-bold text-white underline underline-offset-2';
  return (
    <div role="alert" className="px-2 py-3 font-sans text-[13px] text-rail-text">
      <p>{message}</p>
      {signedOut ? (
        <a className={action} href={signInUrl()}>
          Sign in
        </a>
      ) : (
        <button type="button" className={action} onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
