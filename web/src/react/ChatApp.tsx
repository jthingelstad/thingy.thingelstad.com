// The chat app shell: rail, mobile chatbar, guest banner, thread host,
// dialogs, keyboard shortcuts, and conversation actions. Message-level UI
// lives in components/; the wire protocol lives in thingy-runtime.ts.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { confirmDialog, promptDialog } from '../shared/stores/dialog-store.ts';
import { trackEvent } from '../shared/thingy-analytics.ts';
import * as session from '../shared/thingy-session.ts';
import { type ThingyThreadBinding } from './thingy-runtime.ts';
import { useAgentWelcome } from './hooks/useAgentWelcome.ts';
import { Icon } from './components/Icon.tsx';
import { Rail, type ConversationSummary } from './components/Rail.tsx';
import { ThreadHost } from './components/Thread.tsx';
import { DialogHost } from './components/DialogHost.tsx';

export interface ChatInitial {
  prompt: string;
  from: { href: string; name: string } | null;
}

// Click-to-edit conversation title in the header (Claude convention).
function HeaderTitle({
  title,
  canRename,
  onRename
}: {
  title: string;
  canRename: boolean;
  onRename: (title: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  if (!editing || !canRename) {
    return (
      <div className="mobile-chatbar-title">
        {canRename ? (
          <button
            type="button"
            className="thingy-title-edit"
            title="Rename conversation"
            onClick={() => {
              setDraft(title);
              setEditing(true);
            }}
          >
            {title}
          </button>
        ) : (
          <span>{title}</span>
        )}
      </div>
    );
  }
  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== title) void onRename(next);
  };
  return (
    <div className="mobile-chatbar-title">
      <input
        className="thingy-title-input"
        type="text"
        value={draft}
        maxLength={120}
        autoFocus
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setEditing(false);
        }}
      />
    </div>
  );
}

export function ChatApp({ initial }: { initial: ChatInitial }) {
  const [signedIn] = useState(() => session.sessionActive());
  const guest = !signedIn;
  const [activeId, setActiveId] = useState('');
  // The thread's mount identity. Only explicit navigation (rail click, New
  // chat) may change it: when the FIRST turn of a new thread streams its
  // conversation id back, remounting on that id would wipe the in-flight
  // exchange, so onConversationId updates activeId (rail highlight) only.
  const [mountedId, setMountedId] = useState('');
  const [threadEpoch, setThreadEpoch] = useState(0);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [guestRemaining, setGuestRemaining] = useState<number | null>(null);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const bindingRef = useRef<ThingyThreadBinding | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  const conversationKey = mountedId || `new-${threadEpoch}`;
  const binding = useMemo<ThingyThreadBinding>(() => {
    const next: ThingyThreadBinding = {
      conversationId: mountedId,
      guest,
      onConversationId: (id) => {
        setActiveId(id);
        void refreshConversations();
      },
      onGuestRemaining: setGuestRemaining,
      onTurnRecorded: () => void refreshConversations()
    };
    bindingRef.current = next;
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationKey, guest]);

  const refreshConversations = useCallback(async () => {
    if (guest) return;
    try {
      const data = await session.postJson('/conversations', { action: 'list' }, session.authHeaders());
      const list = Array.isArray(data.conversations) ? data.conversations : [];
      setConversations(
        list.map((entry) => ({
          id: String(entry.conversation_id || entry.id || ''),
          title: String(entry.title || 'Untitled chat'),
          shared_at: String(entry.shared_at || ''),
          updated_at: String(entry.updated_at || '')
        }))
      );
    } catch {
      /* rail stays as-is */
    }
  }, [guest]);

  useEffect(() => {
    if (!guest) void refreshConversations();
    // Event name predates the chat2->chat rename; kept for Tinylytics
    // continuity.
    trackEvent('librarian.chat2_visit', guest ? 'guest' : 'reader');
    // Boot effect: runs once per page load by design.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function newConversation() {
    setActiveId('');
    setMountedId('');
    setThreadEpoch((n) => n + 1);
    setMobileRailOpen(false);
  }

  function selectConversation(id: string) {
    setActiveId(id);
    setMountedId(id);
    setMobileRailOpen(false);
  }

  async function deleteConversation(id: string) {
    const ok = await confirmDialog({
      title: 'Delete this conversation?',
      body: 'The conversation and its saved history are removed for good.',
      confirmLabel: 'Delete',
      danger: true
    });
    if (!ok) return;
    await session.postJson('/conversations', { action: 'delete', conversation_id: id }, session.authHeaders());
    if (id === activeId) newConversation();
    void refreshConversations();
  }

  async function renameConversation(id: string, current: string) {
    const title = (
      await promptDialog({
        title: 'Rename conversation',
        initialValue: current,
        maxLength: 120,
        confirmLabel: 'Rename'
      })
    )?.trim();
    if (!title || title === current) return;
    await session.postJson('/conversations', { action: 'rename', conversation_id: id, title }, session.authHeaders());
    void refreshConversations();
  }

  async function shareConversation(id: string, shared: boolean) {
    const confirmed = await confirmDialog(
      shared
        ? {
            title: 'Refresh the share link?',
            body: 'The link stays the same and picks up the latest messages.',
            confirmLabel: 'Refresh link'
          }
        : {
            title: 'Share this conversation?',
            body: 'Anyone with the link can read the entire conversation, including your questions. You can stop sharing at any time.',
            confirmLabel: 'Share'
          }
    );
    if (!confirmed) return;
    const data = await session.postJson(
      '/conversations',
      { action: 'share', conversation_id: id },
      session.authHeaders()
    );
    const url = String((data.share as { url?: string } | undefined)?.url || '');
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      await promptDialog({ title: 'Copy this share link', initialValue: url, confirmLabel: 'Done', hideCancel: true });
    }
    trackEvent('librarian.share_link_create');
    void refreshConversations();
  }

  const { text: welcome, suggestions } = useAgentWelcome(guest, Boolean(initial.prompt));
  const [railCollapsed, setRailCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem('thingyRailCollapsed') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem('thingyRailCollapsed', railCollapsed ? '1' : '0');
    } catch {
      /* private browsing */
    }
  }, [railCollapsed]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Claude's conventions: Cmd+K = search/filter, Cmd+Shift+O = new chat.
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'o') {
        event.preventDefault();
        newConversation();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setMobileRailOpen(true);
        window.setTimeout(() => filterInputRef.current?.focus(), 60);
      }
    }
    function onStorage(event: StorageEvent) {
      if (event.key !== null && event.key !== session.signedInHintKey && event.key !== session.storageKey) return;
      const nowSignedIn = session.sessionActive();
      // Signed out (or in) from another tab: reload into the right mode.
      if (nowSignedIn !== signedIn) window.location.reload();
    }
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('storage', onStorage);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('storage', onStorage);
    };
    // Bound once; newConversation identity is stable enough for a shortcut.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="thingy-page">
      <h1 className="sr-only">Thingy chat</h1>
      <div
        className={`thingy-app-shell${guest ? ' is-guest' : ''}${mobileRailOpen ? ' is-mobile-rail-open' : ''}${railCollapsed ? ' is-collapsed' : ''}`}
        id="thingy-app-shell"
      >
        {guest ? null : (
          <Rail
            collapsed={railCollapsed}
            onToggleCollapsed={() => setRailCollapsed(!railCollapsed)}
            conversations={conversations}
            activeId={activeId}
            onSelect={selectConversation}
            onNew={newConversation}
            onShare={(id, shared) => void shareConversation(id, shared)}
            onRename={(id, current) => void renameConversation(id, current)}
            onDelete={(id) => void deleteConversation(id)}
            filterInputRef={filterInputRef}
            onSearch={async (query) => {
              const data = await session.postJson('/conversations', { action: 'search', query }, session.authHeaders());
              const matches = (data as { matches?: Array<{ conversation_id?: string; snippet?: string }> }).matches;
              return (Array.isArray(matches) ? matches : []).map((match) => ({
                conversation_id: String(match.conversation_id || ''),
                snippet: String(match.snippet || '')
              }));
            }}
          />
        )}
        {guest ? null : <div className="rail-scrim" aria-hidden="true" onClick={() => setMobileRailOpen(false)} />}
        <section className="thingy-conversation">
          <div className="mobile-chatbar thingy-aui-header">
            {guest ? null : (
              <button
                type="button"
                className="mobile-chatbar-circle"
                aria-label={mobileRailOpen ? 'Hide conversations' : 'Show conversations'}
                aria-expanded={mobileRailOpen}
                onClick={() => setMobileRailOpen(!mobileRailOpen)}
              >
                <Icon name="panel-left" />
              </button>
            )}
            <HeaderTitle
              title={conversations.find((entry) => entry.id === activeId)?.title || 'New chat'}
              canRename={Boolean(activeId)}
              onRename={async (title) => {
                await session.postJson(
                  '/conversations',
                  { action: 'rename', conversation_id: activeId, title },
                  session.authHeaders()
                );
                void refreshConversations();
              }}
            />
            <div className="mobile-chatbar-actions">
              {activeId ? (
                <button
                  type="button"
                  className="mobile-chatbar-action"
                  aria-label="Share conversation"
                  title="Share conversation"
                  onClick={() => {
                    const entry = conversations.find((item) => item.id === activeId);
                    void shareConversation(activeId, Boolean(entry?.shared_at));
                  }}
                >
                  <Icon name="share" />
                </button>
              ) : null}
              <button
                type="button"
                className="mobile-chatbar-action"
                aria-label="New chat"
                title="New chat"
                onClick={newConversation}
              >
                <Icon name="square-pen" />
              </button>
            </div>
          </div>
          {initial.from ? (
            <a className="return-chip" href={initial.from.href} data-tinylytics-event="network.return">
              <Icon name="arrow-left" />
              <span>
                Return to <strong>{initial.from.name}</strong>
              </span>
            </a>
          ) : null}
          {guest ? (
            <aside className="thingy-guest-banner" aria-label="Guest preview">
              <span>
                {guestRemaining === 0
                  ? "You've used today's guest questions."
                  : typeof guestRemaining === 'number'
                    ? `Guest preview — ${guestRemaining} question${guestRemaining === 1 ? '' : 's'} left today.`
                    : 'Guest preview — ask a few questions, no account needed.'}
              </span>
              <a href={session.signInUrl('/chat/')}>Sign in free for more</a>
            </aside>
          ) : null}
          <ThreadHost
            key={conversationKey}
            binding={binding}
            guest={guest}
            welcome={welcome}
            suggestions={mountedId ? [] : suggestions}
            initialPrompt={activeId ? undefined : initial.prompt}
          />
        </section>
      </div>
      <DialogHost />
    </section>
  );
}
