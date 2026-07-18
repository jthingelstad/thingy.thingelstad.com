import { type ComponentChildren } from 'preact';
import { DispatchRecents } from './DispatchRecents.tsx';
import { ThingyIcon } from './ThingyIcon.tsx';

interface DispatchRailProps {
  collapsed: boolean;
  accountMenu: ComponentChildren;
  onToggleCollapsed: () => void;
  onNewDispatch: () => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

function DispatchRail({
  collapsed,
  accountMenu,
  onToggleCollapsed,
  onNewDispatch,
  onOpen,
  onDelete
}: DispatchRailProps) {
  return (
    <aside class="rail" aria-label="Thingy Dispatch">
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
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-pressed={collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggleCollapsed}
        >
          <ThingyIcon name="panel-left" />
        </button>
      </div>
      <nav class="rail-surface-switch" aria-label="Thingy surfaces">
        <a href="/chat/">
          <ThingyIcon name="message-square" />
          <span>Chat</span>
        </a>
        <a class="is-active" href="/dispatch/" aria-current="page">
          <ThingyIcon name="newspaper" />
          <span>Dispatch</span>
        </a>
      </nav>
      <button
        class="rail-newchat dispatch-new"
        type="button"
        data-tinylytics-event="dispatch.new"
        title="New Dispatch"
        onClick={onNewDispatch}
      >
        <ThingyIcon name="plus" />
        <span class="label">New Dispatch</span>
      </button>
      <div class="rail-body">
        <p class="rail-recents-label">Dispatches</p>
        <DispatchRecents onOpen={onOpen} onDelete={onDelete} />
      </div>
      <div class="rail-account">{accountMenu}</div>
    </aside>
  );
}

export { DispatchRail };
