// The chat app shell: rail, mobile chatbar, guest banner, thread host,
// dialogs, keyboard shortcuts, and conversation actions. Message-level UI
// lives in components/; the wire protocol lives in thingy-runtime.ts.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { confirmDialog, promptDialog } from '../shared/stores/dialog-store.ts';
import { trackEvent } from '../shared/thingy-analytics.ts';
import { errorMessage } from '../shared/thingy-errors.ts';
import * as session from '../shared/thingy-session.ts';
import { type ThingyThreadBinding } from './thingy-runtime.ts';
import { useAgentWelcome } from './hooks/useAgentWelcome.ts';
import { Icon } from './components/Icon.tsx';
import { Rail, type ConversationSummary } from './components/Rail.tsx';
import { ThreadHost } from './components/Thread.tsx';
import { DialogHost } from './components/DialogHost.tsx';
import { Tip, TipProvider } from './components/Tip.tsx';
import { HeaderTitle } from './components/HeaderTitle.tsx';
import { HistoryDialog, type HistoryMatch } from './components/HistoryDialog.tsx';

export interface ChatInitial {
  prompt: string;
  from: { href: string; name: string } | null;
  // Deep link (?conversation=<id>): open this conversation on load -
  // used by the share page's "open the original / open in Thingy".
  conversationId?: string;
}

export function ChatApp({ initial }: { initial: ChatInitial }) {
  const [signedIn] = useState(() => session.sessionActive());
  const guest = !signedIn;
  const [activeId, setActiveId] = useState(() => String(initial.conversationId || ''));
  // The thread's mount identity. Only explicit navigation (rail click, New
  // chat) may change it: when the FIRST turn of a new thread streams its
  // conversation id back, remounting on that id would wipe the in-flight
  // exchange, so onConversationId updates activeId (rail highlight) only.
  const [mountedId, setMountedId] = useState(() => String(initial.conversationId || ''));
  const [threadEpoch, setThreadEpoch] = useState(0);
  const [guestRemaining, setGuestRemaining] = useState<number | null>(null);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // Titles learned from history/search selection, so the header can name
  // conversations that sit beyond the rail's loaded window.
  const [knownTitle, setKnownTitle] = useState<{ id: string; title: string } | null>(null);
  const bindingRef = useRef<ThingyThreadBinding | null>(null);
  const filterInputRef = useRef<HTMLInputElement | null>(null);

  // Server state via TanStack Query (2026-09-03): the conversation list
  // is a cached query, mutations update it optimistically, and everything
  // that used to call refreshConversations() invalidates instead.
  const queryClient = useQueryClient();
  type ConversationPage = { conversations: ConversationSummary[]; total: number };
  const { data: conversationData } = useQuery({
    queryKey: ['conversations'],
    enabled: !guest,
    queryFn: async (): Promise<ConversationPage> => {
      const data = await session.postJson('/conversations', { action: 'list' }, session.authHeaders());
      const list = Array.isArray(data.conversations) ? data.conversations : [];
      return {
        conversations: list.map((entry) => ({
          id: String(entry.conversation_id || entry.id || ''),
          title: String(entry.title || 'Untitled chat'),
          shared_at: String(entry.shared_at || ''),
          updated_at: String(entry.updated_at || '')
        })),
        total: Number((data as { total?: number }).total || list.length)
      };
    }
  });
  const conversations = conversationData?.conversations ?? [];
  const conversationTotal = conversationData?.total ?? 0;
  const invalidateConversations = () => {
    void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    void queryClient.invalidateQueries({ queryKey: ['conversations-all'] });
    void queryClient.removeQueries({ queryKey: ['conversation-search'] });
  };

  const conversationKey = mountedId || `new-${threadEpoch}`;
  const binding = useMemo<ThingyThreadBinding>(() => {
    const next: ThingyThreadBinding = {
      conversationId: mountedId,
      guest,
      onConversationId: (id) => {
        setActiveId(id);
        invalidateConversations();
      },
      onGuestRemaining: setGuestRemaining,
      onConversationTitle: (id, title) => setKnownTitle({ id, title }),
      onTurnRecorded: () => invalidateConversations()
    };
    bindingRef.current = next;
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationKey, guest]);

  useEffect(() => {
    // Event name predates the chat2->chat rename; kept for Tinylytics
    // continuity.
    trackEvent('librarian.chat2_visit', guest ? 'guest' : 'reader');
    // Boot effect: runs once per page load by design.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renameMutation = useMutation({
    mutationFn: async ({ id, title }: { id: string; title: string }) => {
      // The rail cache only holds the recent window; the header falls
      // back to knownTitle for deep-history conversations.
      setKnownTitle({ id, title });
      return session.postJson(
        '/conversations',
        { action: 'rename', conversation_id: id, title },
        session.authHeaders()
      );
    },
    onMutate: async ({ id, title }) => {
      await queryClient.cancelQueries({ queryKey: ['conversations'] });
      const previous = queryClient.getQueryData<ConversationPage>(['conversations']);
      queryClient.setQueryData<ConversationPage>(
        ['conversations'],
        (old) =>
          old && {
            ...old,
            conversations: old.conversations.map((entry) => (entry.id === id ? { ...entry, title } : entry))
          }
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['conversations'], context.previous);
    },
    onSettled: invalidateConversations
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) =>
      session.postJson('/conversations', { action: 'delete', conversation_id: id }, session.authHeaders()),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ['conversations'] });
      const previous = queryClient.getQueryData<ConversationPage>(['conversations']);
      queryClient.setQueryData<ConversationPage>(
        ['conversations'],
        (old) =>
          old && {
            ...old,
            conversations: old.conversations.filter((entry) => entry.id !== id),
            total: Math.max(0, old.total - 1)
          }
      );
      return { previous };
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(['conversations'], context.previous);
    },
    onSettled: invalidateConversations
  });

  function newConversation() {
    setActiveId('');
    setMountedId('');
    setThreadEpoch((n) => n + 1);
    setMobileRailOpen(false);
  }

  function selectConversation(id: string, title?: string) {
    setActiveId(id);
    setMountedId(id);
    setMobileRailOpen(false);
    if (title) setKnownTitle({ id, title });
  }

  const headerTitle =
    conversations.find((entry) => entry.id === activeId)?.title ||
    (knownTitle?.id === activeId ? knownTitle.title : '') ||
    'New chat';

  // Permalinks: the URL always names the open conversation
  // (/chat/?conversation=<id>), so reload and copy-link both work, and
  // back/forward walk the conversations you visited. Guests have no
  // server-side conversations to link to.
  const urlSyncedRef = useRef(false);
  useEffect(() => {
    if (guest) return;
    const wanted = activeId ? `/chat/?conversation=${encodeURIComponent(activeId)}` : '/chat/';
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== wanted) {
      // Preserve TanStack Router's own history state; the first sync is a
      // URL normalization and must replace, not push (a pushed entry
      // makes the first Back press look dead).
      const state = { ...window.history.state, thingyConversation: activeId };
      if (urlSyncedRef.current) window.history.pushState(state, '', wanted);
      else window.history.replaceState(state, '', wanted);
    }
    urlSyncedRef.current = true;
  }, [activeId, guest]);

  useEffect(() => {
    document.title = activeId && headerTitle !== 'New chat' ? `${headerTitle} — Thingy` : 'Chat — Thingy';
  }, [activeId, headerTitle]);

  useEffect(() => {
    if (guest) return undefined;
    function onPopState() {
      const id = new URLSearchParams(window.location.search).get('conversation') || '';
      setActiveId(id);
      setMountedId((current) => {
        // Already on the empty new-chat thread: no remount, keep drafts.
        if (!id && !current) return current;
        if (!id) setThreadEpoch((n) => n + 1);
        return id;
      });
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
    // Bound once; setters are stable.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function deleteConversation(id: string) {
    const ok = await confirmDialog({
      title: 'Delete this conversation?',
      body: 'The conversation and its saved history are removed for good.',
      confirmLabel: 'Delete',
      danger: true
    });
    if (!ok) return;
    if (id === activeId) newConversation();
    deleteMutation.mutate(id);
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
    renameMutation.mutate({ id, title });
  }

  async function shareConversation(id: string, shared: boolean) {
    const confirmed = await confirmDialog(
      shared
        ? {
            title: 'This conversation is shared',
            body: 'Anyone with the link can read it. Refreshing keeps the same link and picks up the latest messages; stopping makes the link dead immediately.',
            confirmLabel: 'Refresh & copy link',
            altLabel: 'Stop sharing'
          }
        : {
            title: 'Share this conversation?',
            body: 'Anyone with the link can read the entire conversation, including your questions. You can stop sharing at any time.',
            confirmLabel: 'Share'
          }
    );
    if (!confirmed) return;
    if (confirmed === 'alt') {
      try {
        await session.postJson('/conversations', { action: 'unshare', conversation_id: id }, session.authHeaders());
      } catch (error) {
        await confirmDialog({
          title: 'Could not stop sharing',
          body: errorMessage(error, 'Thingy could not revoke the link. Please try again.'),
          confirmLabel: 'OK',
          hideCancel: true
        });
        return;
      }
      trackEvent('librarian.share_link_revoke');
      invalidateConversations();
      await confirmDialog({
        title: 'Sharing stopped',
        body: 'The link is dead. Anyone who opens it now sees "no longer available."',
        confirmLabel: 'Done',
        hideCancel: true
      });
      return;
    }
    let url = '';
    try {
      const data = await session.postJson(
        '/conversations',
        { action: 'share', conversation_id: id },
        session.authHeaders()
      );
      url = String((data.share as { url?: string } | undefined)?.url || '');
      if (!url) throw new Error('The share response carried no link.');
    } catch (error) {
      await confirmDialog({
        title: 'Sharing failed',
        body: errorMessage(error, 'Thingy could not create the share link. Please try again.'),
        confirmLabel: 'OK',
        hideCancel: true
      });
      return;
    }
    let copied = true;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      copied = false;
    }
    trackEvent('librarian.share_link_create');
    invalidateConversations();
    // Always confirm with the URL in hand - a silent clipboard write reads
    // as "nothing happened".
    await promptDialog({
      title: copied ? 'Share link copied' : 'Copy this share link',
      body: copied
        ? 'The link is in your clipboard. Anyone with it can read this conversation and ask their own follow-ups.'
        : 'Copy the link below - anyone with it can read this conversation and ask their own follow-ups.',
      initialValue: url,
      confirmLabel: 'Done',
      hideCancel: true
    });
  }

  async function searchConversations(query: string): Promise<HistoryMatch[]> {
    const data = await session.postJson('/conversations', { action: 'search', query }, session.authHeaders());
    const matches = (
      data as { matches?: Array<{ conversation_id?: string; snippet?: string; title?: string; updated_at?: string }> }
    ).matches;
    return (Array.isArray(matches) ? matches : []).map((match) => ({
      conversation_id: String(match.conversation_id || ''),
      snippet: String(match.snippet || ''),
      title: String(match.title || ''),
      updated_at: String(match.updated_at || '')
    }));
  }

  async function listConversationPage(offset: number) {
    const data = await session.postJson('/conversations', { action: 'list', offset, limit: 50 }, session.authHeaders());
    const list = Array.isArray(data.conversations) ? data.conversations : [];
    return {
      conversations: list.map((entry) => ({
        id: String(entry.conversation_id || entry.id || ''),
        title: String(entry.title || 'Untitled chat'),
        shared_at: String(entry.shared_at || ''),
        updated_at: String(entry.updated_at || '')
      })),
      total: Number((data as { total?: number }).total || list.length)
    };
  }

  const { text: welcome, suggestions, suggestionsPending } = useAgentWelcome(guest, Boolean(initial.prompt));
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
        setRailCollapsed(false);
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
    <TipProvider>
      <main className="flex h-dvh overflow-hidden bg-bg font-sans text-ink">
        <h1 className="sr-only">Thingy chat</h1>
        <div
          className={`thingy-app-shell flex min-w-0 flex-1${guest ? ' is-guest' : ''}${mobileRailOpen ? ' is-mobile-rail-open' : ''}`}
          id="thingy-app-shell"
        >
          {guest ? null : (
            <>
              <div
                className={`z-40 shrink-0 max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:transition-transform max-md:duration-200 ${
                  mobileRailOpen ? 'max-md:visible max-md:translate-x-0' : 'max-md:invisible max-md:-translate-x-full'
                } ${railCollapsed ? 'md:hidden' : 'md:block'}`}
              >
                <Rail
                  collapsed={false}
                  onToggleCollapsed={() => {
                    setMobileRailOpen(false);
                    setRailCollapsed(true);
                  }}
                  conversations={conversations}
                  activeId={activeId}
                  onSelect={selectConversation}
                  onNew={newConversation}
                  onShare={(id, shared) => void shareConversation(id, shared)}
                  onRename={(id, current) => void renameConversation(id, current)}
                  onDelete={(id) => void deleteConversation(id)}
                  filterInputRef={filterInputRef}
                  onSearch={searchConversations}
                  total={conversationTotal}
                  onOpenHistory={() => setHistoryOpen(true)}
                />
              </div>
              <div
                className={`rail-scrim fixed inset-0 z-30 bg-black/35 md:hidden ${mobileRailOpen ? '' : 'hidden'}`}
                aria-hidden="true"
                onClick={() => setMobileRailOpen(false)}
              />
            </>
          )}
          <section className="thingy-conversation flex min-w-0 flex-1 flex-col">
            <div className="mobile-chatbar flex h-14 shrink-0 items-center gap-2 border-b border-line-soft px-3">
              {guest ? null : (
                <button
                  type="button"
                  className="mobile-chatbar-circle grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink md:hidden [&_svg]:size-[18px]"
                  aria-label={mobileRailOpen ? 'Hide conversations' : 'Show conversations'}
                  aria-expanded={mobileRailOpen}
                  onClick={() => setMobileRailOpen(!mobileRailOpen)}
                >
                  <Icon name="panel-left" />
                </button>
              )}
              {!guest && railCollapsed ? (
                <Tip label="Expand sidebar">
                  <button
                    type="button"
                    className="hidden size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink md:grid [&_svg]:size-[18px]"
                    aria-label="Expand sidebar"
                    onClick={() => setRailCollapsed(false)}
                  >
                    <Icon name="panel-left" />
                  </button>
                </Tip>
              ) : null}
              <HeaderTitle
                title={headerTitle}
                canRename={Boolean(activeId)}
                onRename={async (title) => {
                  renameMutation.mutate({ id: activeId, title });
                }}
              />
              <div className="mobile-chatbar-actions ml-auto flex items-center gap-1">
                {activeId ? (
                  <Tip label="Share conversation">
                    <button
                      type="button"
                      className="mobile-chatbar-action grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink [&_svg]:size-[18px]"
                      aria-label="Share conversation"
                      onClick={() => {
                        const entry = conversations.find((item) => item.id === activeId);
                        void shareConversation(activeId, Boolean(entry?.shared_at));
                      }}
                    >
                      <Icon name="share" />
                    </button>
                  </Tip>
                ) : null}
                <Tip label="New chat">
                  <button
                    type="button"
                    className="mobile-chatbar-action grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink [&_svg]:size-[18px]"
                    aria-label="New chat"
                    onClick={newConversation}
                  >
                    <Icon name="square-pen" />
                  </button>
                </Tip>
              </div>
            </div>
            {initial.from ? (
              <a
                className="return-chip mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[13px] font-semibold text-ink hover:border-accent [&_svg]:size-3.5"
                href={initial.from.href}
                data-tinylytics-event="network.return"
              >
                <Icon name="arrow-left" />
                <span>
                  Return to <strong>{initial.from.name}</strong>
                </span>
              </a>
            ) : null}
            {guest ? (
              <aside
                className="thingy-guest-banner mx-auto mt-3 flex w-[min(48rem,calc(100%-2rem))] flex-wrap items-center justify-between gap-2 rounded-xl border border-accent/40 bg-accent-soft px-4 py-2.5 text-[13.5px] text-ink"
                aria-label="Guest preview"
              >
                <span>
                  {guestRemaining === 0
                    ? "You've used today's guest questions."
                    : typeof guestRemaining === 'number'
                      ? `Guest preview — ${guestRemaining} question${guestRemaining === 1 ? '' : 's'} left today.`
                      : 'Guest preview — ask a few questions, no account needed.'}
                </span>
                <a
                  className="font-bold text-accent-deep underline underline-offset-2"
                  href={session.signInUrl('/chat/')}
                >
                  Sign in free for more
                </a>
              </aside>
            ) : null}
            <ThreadHost
              key={conversationKey}
              binding={binding}
              guest={guest}
              welcome={mountedId ? '' : welcome}
              suggestions={mountedId ? [] : suggestions}
              suggestionsPending={mountedId ? false : suggestionsPending}
              initialPrompt={activeId || threadEpoch > 0 ? undefined : initial.prompt}
              composerLocked={guest && guestRemaining === 0}
              draftKey={guest ? 'guest' : activeId || 'new'}
            />
          </section>
        </div>
        <HistoryDialog
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onSelect={(id, title) => selectConversation(id, title)}
          onShare={(id, shared) => void shareConversation(id, shared)}
          onRename={(id, current) => void renameConversation(id, current)}
          onDelete={(id) => void deleteConversation(id)}
          listPage={listConversationPage}
          search={searchConversations}
        />
        <DialogHost />
      </main>
    </TipProvider>
  );
}
