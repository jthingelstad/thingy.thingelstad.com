// @ts-check
// Drives the rail's collapsed and mobile-open state through signals. Both
// /chat/ and /dispatch/ have identical rail behaviour; the only difference
// is which DOM elements they wire to. This replaces createRailController in
// the deleted thingy-rail.js helper.

import { effect } from '@preact/signals';
import { mobileRailOpen, railCollapsed } from './stores/ui-store.js';

function persistCollapsed(key, value) {
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch (error) {
    /* private mode, no-op */
  }
}

function attachRailState(options = {}) {
  const shell = options.shell || null;
  const mobileToggle = options.mobileToggle || null;
  const scrim = options.scrim || null;
  const collapseButton = options.collapseButton || null;
  const collapsedKey = options.collapsedKey || 'thingyRailCollapsed';
  const showLabel = options.showLabel || 'Show sidebar';
  const hideLabel = options.hideLabel || 'Hide sidebar';

  // Restore the persisted collapsed state on bootstrap.
  if (shell) {
    try {
      if (window.localStorage.getItem(collapsedKey) === '1') railCollapsed.value = true;
    } catch (error) {
      /* ignore */
    }
  }

  const disposers = [];

  // Mirror the collapsed signal onto the shell class and the button's aria.
  disposers.push(
    effect(() => {
      if (!shell) return;
      const collapsed = railCollapsed.value;
      shell.classList.toggle('is-collapsed', collapsed);
      if (collapseButton) {
        collapseButton.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
        collapseButton.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
      }
      persistCollapsed(collapsedKey, collapsed);
    })
  );

  // Mirror the mobile-open signal onto the shell class, the toggle's aria,
  // and the scrim's visibility.
  disposers.push(
    effect(() => {
      if (!shell) return;
      const open = mobileRailOpen.value;
      shell.classList.toggle('is-mobile-rail-open', open);
      if (mobileToggle) {
        mobileToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        mobileToggle.setAttribute('aria-label', open ? hideLabel : showLabel);
        mobileToggle.title = open ? hideLabel : showLabel;
      }
      if (scrim) scrim.hidden = !open;
    })
  );

  if (collapseButton) {
    collapseButton.addEventListener('click', () => {
      railCollapsed.value = !railCollapsed.value;
    });
  }
  if (mobileToggle) {
    mobileToggle.addEventListener('click', () => {
      mobileRailOpen.value = !mobileRailOpen.value;
    });
  }
  if (scrim) {
    scrim.addEventListener('click', () => {
      mobileRailOpen.value = false;
    });
  }

  return {
    setMobileOpen: (open) => {
      mobileRailOpen.value = Boolean(open);
    },
    closeMobile: () => {
      mobileRailOpen.value = false;
    },
    setCollapsed: (collapsed) => {
      railCollapsed.value = Boolean(collapsed);
    },
    dispose: () => disposers.forEach((d) => d())
  };
}

export { attachRailState };
