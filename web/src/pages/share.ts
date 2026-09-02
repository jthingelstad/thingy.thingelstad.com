import '../styles/thingy-share-entry.css';
import { registerClientErrorTracking, trackEvent } from '../shared/thingy-analytics.ts';
import { librarianApiUrl } from '../shared/thingy-config.ts';
import { contractRequestHeaders } from '../shared/thingy-contracts.ts';
import { escapeHtml, renderMarkdown } from '../shared/thingy-markdown.ts';
import { sessionActive } from '../shared/thingy-session.ts';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.ts';

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

function ctaHtml(signedIn: boolean) {
  // Guests can chat now - the chat page runs a guest preview lane, so the
  // CTA goes straight to the product either way.
  const href = '/chat/';
  const label = signedIn ? 'Open Thingy' : 'Ask Thingy yourself';
  return (
    '<aside class="thingy-shared-cta">' +
    '<p>Thingy answers questions about Jamie Thingelstad&rsquo;s public archive &mdash; twenty-five years of writing, with citations.</p>' +
    `<a class="thingy-shared-cta-button" href="${href}" data-tinylytics-event="librarian.share_cta">${label}</a>` +
    ' <a class="thingy-shared-cta-more" href="/about/">What is Thingy?</a>' +
    '</aside>'
  );
}

function unavailableHtml(signedIn: boolean) {
  return (
    '<div class="thingy-shared-header"><h1>This shared conversation is no longer available.</h1>' +
    '<p class="thingy-shared-byline">The link may have been turned off by the person who shared it, or it may have expired.</p></div>' +
    ctaHtml(signedIn)
  );
}

function messageHtml(message: SharedMessage) {
  const content = String(message.content || '');
  if (!content.trim()) return '';
  if (message.role === 'assistant') {
    const citations = Array.isArray(message.citations) ? message.citations : [];
    return (
      '<article class="librarian-message librarian-message-assistant">' +
      `<div class="librarian-answer-content">${renderMarkdown(content, citations)}</div>` +
      '</article>'
    );
  }
  return `<article class="librarian-message librarian-message-user"><p>${escapeHtml(content)}</p></article>`;
}

function conversationHtml(payload: SharedConversationPayload, signedIn: boolean) {
  const title = escapeHtml(String(payload.conversation?.title || 'A Thingy conversation'));
  const sharedDate = friendlyDate(payload.conversation?.shared_at);
  const byline = sharedDate
    ? `Shared from a Thingy conversation &middot; ${sharedDate}`
    : 'Shared from a Thingy conversation';
  const messages = (payload.messages || []).map(messageHtml).join('');
  return (
    `<div class="thingy-shared-header"><h1>${title}</h1><p class="thingy-shared-byline">${byline}</p></div>` +
    `<div class="librarian-messages thingy-shared-messages">${messages}</div>` +
    ctaHtml(signedIn)
  );
}

async function loadSharedConversation(root: HTMLElement) {
  const signedIn = sessionActive();
  const token = shareTokenFromPath(window.location.pathname);
  if (!token) {
    root.innerHTML = unavailableHtml(signedIn);
    return;
  }
  try {
    const response = await fetch(`${librarianApiUrl()}/share/${encodeURIComponent(token)}`, {
      headers: contractRequestHeaders()
    });
    if (!response.ok) {
      root.innerHTML = unavailableHtml(signedIn);
      trackEvent('librarian.share_view', response.status === 404 ? 'gone' : 'error');
      return;
    }
    const payload = (await response.json()) as SharedConversationPayload;
    root.innerHTML = conversationHtml(payload, signedIn);
    document.title = `${String(payload.conversation?.title || 'Shared Conversation')} — Thingy`;
    trackEvent('librarian.share_view', signedIn ? 'signed_in' : 'signed_out');
  } catch (_error) {
    root.innerHTML = unavailableHtml(signedIn);
    trackEvent('librarian.share_view', 'error');
  }
}

registerClientErrorTracking('share');
const root = document.getElementById('thingy-shared-root');
if (root) void loadSharedConversation(root);
loadTinylytics();
