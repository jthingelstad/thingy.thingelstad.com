import type { ComponentChildren } from 'preact';
import { modeIcon } from '../thingy-modes.ts';
import { RailRecents } from './RailRecents.tsx';
import { ThingyIcon } from './ThingyIcon.tsx';

interface ChatRailProps {
  collapsed: boolean;
  busy: boolean;
  showModeUi: boolean;
  modeMenuOpen: boolean;
  selectedMode: string;
  selectedModeLabel: string;
  modes: ThingyMode[];
  sourcesAvailable: boolean;
  accountMenu: ComponentChildren;
  onToggleCollapsed: () => void;
  onNewConversation: () => void;
  onToggleModeMenu: () => void;
  onChooseMode: (mode: string) => void;
  onCuriosityMap: () => void;
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

      <nav class="rail-surface-switch" aria-label="Thingy surfaces">
        <a class="is-active" href="/chat/" aria-current="page">
          <ThingyIcon name="message-square" />
          <span>Chat</span>
        </a>
        <a href="/dispatch/">
          <ThingyIcon name="newspaper" />
          <span>Dispatch</span>
        </a>
      </nav>

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
        <div class="rail-newchat-mode" hidden={!props.showModeUi}>
          <button
            class="rail-newchat-mode-button"
            type="button"
            disabled={props.busy}
            aria-haspopup="listbox"
            aria-expanded={props.modeMenuOpen}
            aria-controls="thingy-mode-menu"
            aria-label={`New chat mode: ${props.selectedModeLabel}`}
            onClick={(event) => {
              event.stopPropagation();
              props.onToggleModeMenu();
            }}
          >
            <span class="rail-newchat-mode-icon">
              <ThingyIcon name={modeIcon(props.selectedMode)} />
            </span>
            <span class="rail-newchat-mode-label">{props.selectedModeLabel}</span>
            <span class="rail-newchat-mode-caret">
              <ThingyIcon name="chevron-down" />
            </span>
          </button>
          <div
            class="rail-newchat-mode-menu"
            id="thingy-mode-menu"
            hidden={!props.modeMenuOpen}
            role="listbox"
            aria-label="New chat mode"
          >
            {props.modes.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="option"
                class="rail-newchat-mode-option"
                aria-selected={mode.id === props.selectedMode}
                onClick={() => props.onChooseMode(mode.id)}
              >
                <span class="rail-newchat-mode-option-icon">
                  <ThingyIcon name={modeIcon(mode.id)} />
                </span>
                <span>{mode.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <button
        class="rail-newchat rail-map"
        type="button"
        disabled={props.busy || !props.sourcesAvailable}
        title="Curiosity map"
        onClick={props.onCuriosityMap}
      >
        <ThingyIcon name="network" />
        <span class="label">Curiosity map</span>
      </button>

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
