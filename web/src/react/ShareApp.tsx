// The public shared-conversation page (/c/<token>) - and since contract
// 4.7 a LIVE one: the shared transcript loads into the real chat thread
// with a working composer, so a visitor can ask their own follow-up
// right away. Guests continue on the guest lane (server-seeded context
// via the share token); signed-in readers fork into a new conversation
// of their own. The share's OWNER gets "open the original" instead of a
// fork of their own conversation.

import { useEffect, useMemo, useState } from 'react';
import { trackEvent } from '../shared/thingy-analytics.ts';
import { librarianApiUrl } from '../shared/thingy-config.ts';
import { contractRequestHeaders } from '../shared/thingy-contracts.ts';
import { sessionActive, signInUrl } from '../shared/thingy-session.ts';
import { TipProvider } from './components/Tip.tsx';
import { ThreadHost } from './components/Thread.tsx';
import { DialogHost } from './components/DialogHost.tsx';
import type { ThingyThreadBinding } from './thingy-runtime.ts';

interface SharedMessage {
  role?: string;
  content?: string;
  citations?: unknown;
  created_at?: string;
}

interface SharedConversationPayload {
  conversation?: {
    title?: string;
    created_at?: string;
    shared_at?: string;
    owner?: boolean;
    conversation_id?: string;
  };
  messages?: SharedMessage[];
  error?: string;
}

function friendlyDate(value: unknown) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function Unavailable({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="thingy-shared-header">
        <h1 className="text-[22px] font-extrabold">This shared conversation is no longer available.</h1>
        <p className="mt-1.5 text-[14.5px] text-ink-soft">
          The link may have been turned off by the person who shared it, or it may have expired.
        </p>
      </div>
      <aside className="thingy-shared-cta mt-6">
        <p className="text-[14px] text-ink-soft">
          Thingy answers questions about Jamie Thingelstad&rsquo;s public archive &mdash; twenty-five years of writing,
          with citations.
        </p>
        <a
          className="thingy-shared-cta-button mt-3 inline-block rounded-lg px-4 py-2 font-bold"
          href="/chat/"
          data-tinylytics-event="librarian.share_cta"
        >
          {signedIn ? 'Open Thingy' : 'Ask Thingy yourself'}
        </a>
      </aside>
    </div>
  );
}

export function ShareApp({ token = '' }: { token?: string }) {
  const [signedIn] = useState(() => sessionActive());
  const [payload, setPayload] = useState<SharedConversationPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [forkedId, setForkedId] = useState('');

  useEffect(() => {
    if (!token || !/^[A-Za-z0-9_-]+$/.test(token)) {
      setFailed(true);
      return;
    }
    void (async () => {
      try {
        const response = await fetch(`${librarianApiUrl()}/share/${encodeURIComponent(token)}`, {
          headers: contractRequestHeaders(),
          credentials: 'include'
        });
        if (!response.ok) {
          setFailed(true);
          trackEvent('librarian.share_view', response.status === 404 ? 'gone' : 'error');
          return;
        }
        const data = (await response.json()) as SharedConversationPayload;
        setPayload(data);
        document.title = `${String(data.conversation?.title || 'Shared Conversation')} — Thingy`;
        trackEvent('librarian.share_view', signedIn ? 'signed_in' : 'signed_out');
      } catch {
        setFailed(true);
        trackEvent('librarian.share_view', 'error');
      }
    })();
    // One fetch per page load.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sharedMessages = useMemo(
    () => (payload?.messages || []).filter((message) => String(message.content || '').trim()),
    [payload]
  );
  const isOwner = Boolean(payload?.conversation?.owner && payload.conversation.conversation_id);

  const binding = useMemo<ThingyThreadBinding>(
    () => ({
      conversationId: '',
      guest: !signedIn,
      shareToken: token,
      sharedMessageCount: sharedMessages.length,
      onConversationId: (id) => setForkedId(id)
    }),
    // The binding mounts once per share load.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [sharedMessages.length]
  );

  const BANNER =
    'mx-auto mt-1 flex w-[min(48rem,calc(100%-2rem))] flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/40 bg-accent-soft px-4 py-2.5 text-[13.5px]';

  return (
    <TipProvider>
      <header className="thingy-page-nav">
        <a className="brand" href="/">
          <img src="/img/thingy.png" alt="" />
          Thingy
        </a>
        <nav>
          <a href="/chat/">Chat</a>
          <a href="/about/">About</a>
          <a href="/connect/">Connect</a>
        </nav>
      </header>
      <main className="flex h-[calc(100dvh-57px)] flex-col bg-bg font-sans text-ink">
        {failed ? (
          <Unavailable signedIn={signedIn} />
        ) : !payload ? null : (
          <>
            <div className="thingy-shared-header mx-auto w-full max-w-3xl px-4 pt-5 pb-2">
              <h1 className="text-[19px] leading-tight font-extrabold">
                {String(payload.conversation?.title || 'A Thingy conversation')}
              </h1>
              <p className="mt-0.5 text-[12.5px] text-muted">
                Shared from a Thingy conversation
                {friendlyDate(payload.conversation?.shared_at)
                  ? ` · ${friendlyDate(payload.conversation?.shared_at)}`
                  : ''}
              </p>
            </div>
            {isOwner ? (
              <aside className={BANNER}>
                <span>This is your shared conversation — this page is what visitors see.</span>
                <a
                  className="font-bold text-accent-deep underline underline-offset-2"
                  href={`/chat/?conversation=${encodeURIComponent(String(payload.conversation?.conversation_id))}`}
                >
                  Open the original
                </a>
              </aside>
            ) : forkedId && signedIn ? (
              <aside className={BANNER}>
                <span>Saved to your chats as a new conversation.</span>
                <a
                  className="font-bold text-accent-deep underline underline-offset-2"
                  href={`/chat/?conversation=${encodeURIComponent(forkedId)}`}
                >
                  Open in Thingy
                </a>
              </aside>
            ) : !signedIn ? (
              <aside className={`thingy-guest-banner ${BANNER}`} aria-label="Guest preview">
                <span>
                  You&rsquo;re reading a shared Thingy conversation — ask your own follow-up, no account needed.
                </span>
                <a className="font-bold text-accent-deep underline underline-offset-2" href={signInUrl('/chat/')}>
                  Sign in free for more
                </a>
              </aside>
            ) : null}
            <div className="thingy-shared-messages flex min-h-0 flex-1 flex-col">
              {isOwner ? null : (
                <ThreadHost
                  binding={binding}
                  guest={!signedIn}
                  welcome=""
                  suggestions={[]}
                  sharedMessages={sharedMessages}
                />
              )}
              {isOwner ? (
                <ThreadHost
                  binding={{ conversationId: '', guest: true, sharedMessageCount: sharedMessages.length }}
                  guest
                  welcome=""
                  suggestions={[]}
                  sharedMessages={sharedMessages}
                  readOnly
                />
              ) : null}
            </div>
          </>
        )}
      </main>
      <DialogHost />
    </TipProvider>
  );
}
