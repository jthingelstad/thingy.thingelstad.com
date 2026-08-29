import type { ComponentChildren } from 'preact';
import { RailRecents } from './RailRecents.tsx';
import { ThingyIcon } from './ThingyIcon.tsx';

interface ChatRailProps {
  collapsed: boolean;
  busy: boolean;
  accountMenu: ComponentChildren;
  onToggleCollapsed: () => void;
  onNewConversation: () => void;
  onOpenConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
}

function ChatRail(props: ChatRailProps) {
  return (
    <aside class="rail" aria-label="Thingy">
      <div class="rail-top">
        <a
          class="rail-brand"
          href="/"
          aria-label="Thingy home"
          data-tinylytics-event="network.home"
          data-tinylytics-event-value="thingy"
        >
          <img class="rail-mark" src="/img/thingy.png" alt="" width="1022" height="1022" loading="eager" />
        </a>
        <button
          class="rail-iconbtn rail-collapse"
          type="button"
          aria-label={props.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={props.collapsed}
          title={props.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={props.onToggleCollapsed}
        >
          <ThingyIcon name="panel-left" />
        </button>
      </div>

      <div class="rail-newchat-combo">
        <button
          class="rail-newchat"
          type="button"
          disabled={props.busy}
          title="New chat"
          onClick={props.onNewConversation}
        >
          <ThingyIcon name="plus" />
          <span class="label">New chat</span>
          <span class="kbd">⌘K</span>
        </button>
      </div>

      <div class="rail-body">
        <p class="rail-recents-label">Recents</p>
        <RailRecents maxRecents={20} onOpen={props.onOpenConversation} onDelete={props.onDeleteConversation} />
      </div>

      <div class="rail-account">{props.accountMenu}</div>
    </aside>
  );
}

interface MobileChatBarProps {
  mobileOpen: boolean;
  conversationTitle: string;
  busy: boolean;
  hasActiveConversation: boolean;
  menuOpen: boolean;
  onToggleRail: () => void;
  onNewConversation: () => void;
  onToggleMenu: () => void;
  onRename: () => void;
  onDelete: () => void;
}

function MobileChatBar(props: MobileChatBarProps) {
  return (
    <div class="mobile-chatbar" aria-label="Conversation">
      <button
        class="mobile-chatbar-circle"
        type="button"
        aria-label={props.mobileOpen ? 'Hide conversations' : 'Show conversations'}
        aria-expanded={props.mobileOpen}
        title={props.mobileOpen ? 'Hide conversations' : 'Show conversations'}
        onClick={props.onToggleRail}
      >
        <ThingyIcon name="chevron-left" />
      </button>
      <div class="mobile-chatbar-title">
        <span>{props.conversationTitle}</span>
      </div>
      <div class="mobile-chatbar-actions">
        <button
          class="mobile-chatbar-action"
          type="button"
          disabled={props.busy}
          aria-label="New chat"
          title="New chat"
          onClick={props.onNewConversation}
        >
          <ThingyIcon name="pencil" />
        </button>
        <button
          class="mobile-chatbar-menu-button"
          type="button"
          disabled={!props.hasActiveConversation || props.busy}
          aria-label="Conversation actions"
          aria-expanded={props.menuOpen}
          aria-controls="mobile-conversation-menu"
          title={props.hasActiveConversation ? 'Conversation actions' : 'No conversation actions'}
          onClick={(event) => {
            event.stopPropagation();
            props.onToggleMenu();
          }}
        >
          <ThingyIcon name="more-horizontal" />
        </button>
        <div class="mobile-conversation-menu" id="mobile-conversation-menu" hidden={!props.menuOpen} role="menu">
          <button type="button" role="menuitem" onClick={props.onRename}>
            Rename
          </button>
          <button type="button" role="menuitem" class="danger" onClick={props.onDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export { ChatRail, MobileChatBar };
