// The public shared-conversation page (/c/<token>) - React port of the
// vanilla share renderer, reusing the chat's markdown pipeline so shared
// answers render exactly like the live ones (WT autolinks, code blocks).

import { useEffect, useState } from 'react';
import { trackEvent } from '../shared/thingy-analytics.ts';
import { librarianApiUrl } from '../shared/thingy-config.ts';
import { contractRequestHeaders } from '../shared/thingy-contracts.ts';
import { sessionActive } from '../shared/thingy-session.ts';
import { ThingyMarkdown } from './components/MarkdownText.tsx';

interface SharedMessage {
  role?: string;
  content?: string;
  citations?: ThingyCitation[];
  created_at?: string;
}

interface SharedConversationPayload {
  conversation?: { title?: string; created_at?: string; shared_at?: string };
  messages?: SharedMessage[];
  error?: string;
}

function shareTokenFromPath(pathname: string) {
  const match = /^\/c\/([A-Za-z0-9_-]+)\/?$/.exec(pathname);
  return match ? match[1] : '';
}

function friendlyDate(value: unknown) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function Cta({ signedIn }: { signedIn: boolean }) {
  // Guests can chat now - the chat page runs a guest preview lane, so the
  // CTA goes straight to the product either way.
  return (
    <aside className="thingy-shared-cta">
      <p>
        Thingy answers questions about Jamie Thingelstad&rsquo;s public archive &mdash; twenty-five years of writing,
        with citations.
      </p>
      <a className="thingy-shared-cta-button" href="/chat/" data-tinylytics-event="librarian.share_cta">
        {signedIn ? 'Open Thingy' : 'Ask Thingy yourself'}
      </a>{' '}
      <a className="thingy-shared-cta-more" href="/about/">
        What is Thingy?
      </a>
    </aside>
  );
}

function Unavailable({ signedIn }: { signedIn: boolean }) {
  return (
    <>
      <div className="thingy-shared-header">
        <h1>This shared conversation is no longer available.</h1>
        <p className="thingy-shared-byline">
          The link may have been turned off by the person who shared it, or it may have expired.
        </p>
      </div>
      <Cta signedIn={signedIn} />
    </>
  );
}

export function ShareApp() {
  const [signedIn] = useState(() => sessionActive());
  const [payload, setPayload] = useState<SharedConversationPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const token = shareTokenFromPath(window.location.pathname);
    if (!token) {
      setFailed(true);
      return;
    }
    void (async () => {
      try {
        const response = await fetch(`${librarianApiUrl()}/share/${encodeURIComponent(token)}`, {
          headers: contractRequestHeaders()
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

  if (failed) return <Unavailable signedIn={signedIn} />;
  if (!payload) return null;

  const sharedDate = friendlyDate(payload.conversation?.shared_at);
  const messages = (payload.messages || []).filter((message) => String(message.content || '').trim());
  return (
    <>
      <div className="thingy-shared-header">
        <h1>{String(payload.conversation?.title || 'A Thingy conversation')}</h1>
        <p className="thingy-shared-byline">Shared from a Thingy conversation{sharedDate ? ` · ${sharedDate}` : ''}</p>
      </div>
      <div className="librarian-messages thingy-shared-messages">
        {messages.map((message, index) =>
          message.role === 'assistant' ? (
            <article key={index} className="librarian-message librarian-message-assistant">
              <div className="librarian-answer-content">
                <ThingyMarkdown
                  text={String(message.content || '')}
                  citations={Array.isArray(message.citations) ? message.citations : []}
                />
              </div>
            </article>
          ) : (
            <article key={index} className="librarian-message librarian-message-user">
              <p>{String(message.content || '')}</p>
            </article>
          )
        )}
      </div>
      <Cta signedIn={signedIn} />
    </>
  );
}
