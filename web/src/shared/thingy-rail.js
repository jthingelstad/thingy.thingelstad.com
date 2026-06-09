function createRailController(options = {}) {
    const shell = options.shell || null;
    const mobileToggle = options.mobileToggle || null;
    const scrim = options.scrim || null;
    const collapseButton = options.collapseButton || null;
    const collapsedKey = options.collapsedKey || 'thingyRailCollapsed';
    const showLabel = options.showLabel || 'Show sidebar';
    const hideLabel = options.hideLabel || 'Hide sidebar';

    function setMobileOpen(open) {
      if (!shell) return;
      shell.classList.toggle('is-mobile-rail-open', Boolean(open));
      if (mobileToggle) {
        mobileToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        mobileToggle.setAttribute('aria-label', open ? hideLabel : showLabel);
        mobileToggle.title = open ? hideLabel : showLabel;
      }
      if (scrim) scrim.hidden = !open;
    }

    function setCollapsed(collapsed) {
      if (!shell) return;
      shell.classList.toggle('is-collapsed', Boolean(collapsed));
      if (collapseButton) {
        collapseButton.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
        collapseButton.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
      }
      try { window.localStorage.setItem(collapsedKey, collapsed ? '1' : '0'); } catch (error) { /* ignore */ }
    }

    if (shell) {
      try {
        if (window.localStorage.getItem(collapsedKey) === '1') setCollapsed(true);
      } catch (error) { /* ignore */ }
    }
    if (collapseButton) {
      collapseButton.addEventListener('click', () => setCollapsed(!shell?.classList.contains('is-collapsed')));
    }
    if (mobileToggle) {
      mobileToggle.addEventListener('click', () => setMobileOpen(!shell?.classList.contains('is-mobile-rail-open')));
    }
    if (scrim) {
      scrim.addEventListener('click', () => setMobileOpen(false));
    }

    return {
      setMobileOpen,
      closeMobile: () => setMobileOpen(false),
      setCollapsed
    };
  }

export { createRailController };
