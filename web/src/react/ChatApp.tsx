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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        newConversation();
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
            <div className="mobile-chatbar-title">
              <span>{conversations.find((c) => c.id === activeId)?.title || 'New chat'}</span>
            </div>
            <div className="mobile-chatbar-actions">
              <button
                type="button"
                className="mobile-chatbar-action"
                aria-label="New chat"
                title="New chat"
                onClick={newConversation}
              >
                <Icon name="pencil" />
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
