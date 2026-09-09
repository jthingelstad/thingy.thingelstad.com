import { signInUrl } from '../../shared/thingy-session.ts';
import { isAuthError } from '../../shared/thingy-url.ts';

export function HistoryStatus({ error, retry }: { error: unknown; retry: () => void }) {
  const signedOut = isAuthError(error);
  return (
    <div role="alert" className="px-2 py-3 font-sans text-[13px] text-muted">
      <p>{signedOut ? 'Sign in again to load your saved chats.' : 'Could not load your chats. Please try again.'}</p>
      {signedOut ? (
        <a className="mt-2 inline-block font-bold text-accent-deep underline" href={signInUrl()}>
          Sign in
        </a>
      ) : (
        <button type="button" className="mt-2 font-bold text-accent-deep underline" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
