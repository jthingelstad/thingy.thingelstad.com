import { signInUrl } from '../../shared/thingy-session.ts';
import { isAuthError } from '../../shared/thingy-url.ts';

// onRail: the navy chat rail, where the muted and clay tones on cream
// would fail contrast - cream text and white actions instead.
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
  const action = onRail
    ? 'inline-flex min-h-11 items-center font-bold text-white underline underline-offset-2'
    : 'mt-2 inline-block font-bold text-accent-deep underline';
  return (
    <div role="alert" className={`px-2 py-3 font-sans text-[13px] ${onRail ? 'text-rail-text' : 'text-muted'}`}>
      <p>{signedOut ? 'Sign in again to load your saved chats.' : 'Could not load your chats. Please try again.'}</p>
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
