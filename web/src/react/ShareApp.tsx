// The public shared-conversation page (/c/<token>) - and since contract
// 4.7 a LIVE one: the shared transcript loads into the real chat thread
// with a working composer, so a visitor can ask their own follow-up
// right away. Guests continue on the guest lane (server-seeded context
// via the share token); signed-in readers fork into a new conversation
// of their own. The share's OWNER gets "open the original" instead of a
// fork of their own conversation.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { trackEvent } from '../shared/thingy-analytics.ts';
import { librarianApiUrl } from '../shared/thingy-config.ts';
import { contractRequestHeaders } from '../shared/thingy-contracts.ts';
import { sessionActive, signInUrl } from '../shared/thingy-session.ts';
import { TipProvider } from './components/Tip.tsx';
import { ThreadHost } from './components/Thread.tsx';
import { DialogHost } from './components/DialogHost.tsx';
import { Icon } from './components/Icon.tsx';
import { ThingyFace } from './components/ThingyFace.tsx';
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

// A revoked/expired link ('gone') and a network hiccup ('error') are
// different situations: only the first is unrecoverable. Conflating them
// told readers on a flaky connection the conversation was gone.
type ShareStatus = 'loading' | 'gone' | 'error' | 'ready';

function friendlyDate(value: unknown) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

// Felt & Tangerine share states: the closed link gets the oops face and
// a toy-cream invitation; a failed load gets the mascot and a retry.
const STATE_TITLE =
  'thingy-display m-0 max-w-[680px] text-[32px] leading-[1.05] text-balance text-ink sm:text-[48px] sm:leading-[1.02]';
const STATE_BODY = 'm-0 max-w-[560px] text-[16px] leading-[1.55] text-ink-soft sm:text-[18px]';

function Unavailable({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="mx-auto flex w-full max-w-[808px] flex-col items-center gap-6 px-4 pt-7 pb-10 text-center sm:gap-7 sm:px-6 sm:pt-12">
      <ThingyFace mood="oops" animated={false} className="w-[118px] sm:w-[136px]" size={136} />
      <div className="thingy-shared-header flex flex-col items-center gap-3.5">
        <h1 className={STATE_TITLE}>This shared conversation has been closed up.</h1>
        <p className={STATE_BODY}>
          The link may have been turned off by the person who shared it, or it may have expired.
        </p>
      </div>
      <aside className="thingy-shared-cta flex w-full max-w-[560px] flex-col items-center gap-4 rounded-[20px] border-2 border-ink bg-toy p-5 shadow-[0_6px_0_var(--thingy-ink)] sm:gap-[18px] sm:px-7 sm:py-6">
        <p className="m-0 text-[16px] leading-[1.55] text-ink sm:text-[17px]">
          Thingy answers questions about Jamie Thingelstad&rsquo;s public archive &mdash; twenty-five years of writing,
          with citations.
        </p>
        <a
          className="thingy-shared-cta-button thingy-btn thingy-btn-primary min-h-[52px] px-6 text-[17px] sm:min-h-14 sm:px-7 sm:text-[18px] [&_svg]:size-5"
          href="/chat/"
          data-tinylytics-event="librarian.share_cta"
        >
          {signedIn ? 'Open Thingy' : 'Ask Thingy yourself'}
          <Icon name="arrow-right" />
        </a>
      </aside>
    </div>
  );
}

function LoadFailed({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-[808px] flex-col items-center gap-5 px-4 pt-5 pb-10 text-center sm:gap-6 sm:px-6 sm:pt-10">
      <div className="relative size-40 sm:size-[200px]" aria-hidden="true">
        <span className="absolute bottom-1 left-6 h-3.5 w-28 rounded-[50%] bg-[#e4d6b6] sm:left-[30px] sm:h-4 sm:w-[140px]" />
        <img
          className="absolute inset-0 size-full select-none"
          src="/img/thingy.png"
          alt=""
          width="1022"
          height="1022"
          draggable={false}
        />
      </div>
      <div className="thingy-shared-header flex flex-col items-center gap-3.5">
        <h1 className={STATE_TITLE}>Couldn&rsquo;t load this conversation.</h1>
        <p className={STATE_BODY}>
          Something went wrong on the way to the archive &mdash; the link itself is probably fine.
        </p>
      </div>
      <button
        type="button"
        className="thingy-error-retry thingy-btn thingy-btn-secondary min-h-[52px] px-[26px] text-[17px] font-extrabold [&_svg]:size-[18px]"
        onClick={onRetry}
      >
        <Icon name="rotate-ccw" />
        Try again
      </button>
    </div>
  );
}

// Shimmer transcript while the snapshot fetch runs: the page used to be
// blank under the nav for the whole request.
function LoadingTranscript() {
  return (
    <div className="thingy-shared-loading mx-auto w-full max-w-3xl px-4 pt-6" aria-hidden="true">
      <div className="h-9 w-[280px] max-w-full animate-pulse rounded-lg bg-toy sm:h-11 sm:w-[420px]" />
      <div className="mt-3 h-[13px] w-[220px] max-w-full animate-pulse rounded-lg bg-toy sm:mt-3.5 sm:h-3.5 sm:w-[260px]" />
      <div className="mt-8 ml-auto h-12 w-[72%] animate-pulse rounded-[20px] bg-toy sm:mt-10 sm:h-[52px] sm:w-3/5 sm:rounded-[22px]" />
      <div className="mt-7 flex flex-col gap-3 sm:mt-8">
        <div className="h-[15px] w-full animate-pulse rounded-lg bg-toy sm:h-4" />
        <div className="h-[15px] w-[92%] animate-pulse rounded-lg bg-toy sm:h-4" />
        <div className="h-[15px] w-2/3 animate-pulse rounded-lg bg-toy sm:h-4" />
      </div>
    </div>
  );
}

// The ticket banner: a polka-dot tangerine stub, a dashed tear line, the
// note and its action. Stacks on a phone.
function Ticket({
  className = '',
  label,
  children,
  action
}: {
  className?: string;
  label: string;
  children: ReactNode;
  action: ReactNode;
}) {
  return (
    <aside
      className={`${className} mb-[22px] flex overflow-hidden rounded-2xl border-2 border-ink bg-paper shadow-[0_4px_0_var(--thingy-ink)] sm:mb-7`.trim()}
      aria-label={label}
    >
      <div
        className="thingy-polka w-5 shrink-0 border-r-2 border-dashed border-ink [background-size:12px_12px] sm:w-[30px] sm:[background-size:16px_16px]"
        aria-hidden="true"
      />
      <div className="flex grow flex-col items-start gap-3 px-3.5 pt-3.5 pb-4 text-[15px] leading-[1.45] text-ink sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:px-[18px] sm:py-3.5 sm:text-[16px]">
        {children}
        {action}
      </div>
    </aside>
  );
}

const TICKET_ACTION = 'thingy-shared-cta-button thingy-btn thingy-btn-compact h-11 px-[18px] font-extrabold';

export function ShareApp({ token = '' }: { token?: string }) {
  const [signedIn] = useState(() => sessionActive());
  const [payload, setPayload] = useState<SharedConversationPayload | null>(null);
  const [status, setStatus] = useState<ShareStatus>('loading');
  const [forkedId, setForkedId] = useState('');
  const [guestRemaining, setGuestRemaining] = useState<number | null>(null);

  const load = useCallback(() => {
    if (!token || !/^[A-Za-z0-9_-]+$/.test(token)) {
      setStatus('gone');
      return;
    }
    setStatus('loading');
    void (async () => {
      try {
        const response = await fetch(`${librarianApiUrl()}/share/${encodeURIComponent(token)}`, {
          headers: contractRequestHeaders(),
          credentials: 'include'
        });
        if (!response.ok) {
          // 404 = revoked or expired; anything else is the server's bad
          // moment, not the link's.
          const gone = response.status === 404;
          setStatus(gone ? 'gone' : 'error');
          trackEvent('librarian.share_view', gone ? 'gone' : 'error');
          return;
        }
        const data = (await response.json()) as SharedConversationPayload;
        setPayload(data);
        setStatus('ready');
        document.title = `${String(data.conversation?.title || 'Shared Conversation')} — Thingy`;
        trackEvent('librarian.share_view', signedIn ? 'signed_in' : 'signed_out');
      } catch {
        setStatus('error');
        trackEvent('librarian.share_view', 'error');
      }
    })();
    // signedIn is fixed for the page's lifetime.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

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
      onConversationId: (id) => setForkedId(id),
      onGuestRemaining: setGuestRemaining
    }),
    // The binding mounts once per share load.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    [sharedMessages.length]
  );

  const sharedOn = friendlyDate(payload?.conversation?.shared_at);
  // Title, meta line and banner scroll with the transcript (the thread's
  // lead slot); the composer stays pinned below.
  const lead = (
    <>
      <div className="thingy-shared-header mb-[22px] flex flex-col gap-2.5 sm:mb-7 sm:gap-3">
        <h1 className="thingy-display m-0 text-[36px] leading-[1.02] text-balance text-ink sm:text-[56px] sm:leading-none">
          {String(payload?.conversation?.title || 'A Thingy conversation')}
        </h1>
        <p className="m-0 font-mono text-[12px] leading-normal text-meta sm:text-[13px]">
          Shared from a Thingy conversation
          {sharedOn ? ` · ${sharedOn}` : ''}
        </p>
      </div>
      {isOwner ? (
        <Ticket
          label="Your shared conversation"
          action={
            <a
              className={`${TICKET_ACTION} thingy-btn-secondary`}
              href={`/chat/?conversation=${encodeURIComponent(String(payload?.conversation?.conversation_id))}`}
            >
              Open the original
            </a>
          }
        >
          <span>This is your shared conversation — this page is what visitors see.</span>
        </Ticket>
      ) : forkedId && signedIn ? (
        <Ticket
          label="Saved to your chats"
          action={
            <a
              className={`${TICKET_ACTION} thingy-btn-primary`}
              href={`/chat/?conversation=${encodeURIComponent(forkedId)}`}
            >
              Open in Thingy
            </a>
          }
        >
          <span className="inline-flex items-start gap-2 sm:items-center sm:gap-2.5">
            <span className="mt-px shrink-0 text-success sm:mt-0 [&_svg]:size-5" aria-hidden="true">
              <Icon name="check" />
            </span>
            Tucked into your chats as a new conversation.
          </span>
        </Ticket>
      ) : !signedIn ? (
        <Ticket
          className="thingy-guest-banner"
          label="Guest preview"
          action={
            <a
              className={`${TICKET_ACTION} thingy-btn-secondary`}
              href={signInUrl()}
              data-tinylytics-event="librarian.guest_signin_click"
            >
              Sign in free for more
            </a>
          }
        >
          <span>You&rsquo;re reading a shared Thingy conversation — ask your own follow-up, no account needed.</span>
        </Ticket>
      ) : null}
    </>
  );

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
      <main className="thingy-share-shell flex h-[calc(100dvh-57px)] flex-col bg-bg font-sans text-ink">
        {status === 'gone' ? (
          <Unavailable signedIn={signedIn} />
        ) : status === 'error' ? (
          <LoadFailed onRetry={load} />
        ) : status === 'loading' || !payload ? (
          <LoadingTranscript />
        ) : (
          <div className="thingy-shared-messages flex min-h-0 flex-1 flex-col">
            {isOwner ? null : (
              <ThreadHost
                binding={binding}
                guest={!signedIn}
                welcome=""
                suggestions={[]}
                sharedMessages={sharedMessages}
                composerLocked={!signedIn && guestRemaining === 0}
                draftKey={`share:${token}`}
                lead={lead}
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
                lead={lead}
              />
            ) : null}
          </div>
        )}
      </main>
      <DialogHost />
    </TipProvider>
  );
}
