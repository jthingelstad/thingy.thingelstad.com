function safeStateClass(value) {
  return String(value || '').replace(/[^a-z0-9_-]/gi, '');
}

function createRailRecentItem(options = {}) {
  const id = String(options.id || '');
  const rowClasses = [
    'rail-recent',
    options.className || '',
    options.active ? 'is-active' : '',
    options.hasMeta ? 'has-mode' : '',
    options.state ? `is-${safeStateClass(options.state)}` : ''
  ].filter(Boolean);

  const row = document.createElement('div');
  row.className = rowClasses.join(' ');
  row.setAttribute('role', 'listitem');
  if (options.dataMode) row.dataset.mode = options.dataMode;

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'rail-recent-open';
  openButton.dataset.id = id;
  if (options.title) openButton.title = options.title;
  if (options.active) openButton.setAttribute('aria-current', 'true');

  const titleEl = document.createElement('span');
  titleEl.className = 'rail-recent-title';
  titleEl.textContent = options.label || 'Untitled';
  openButton.appendChild(titleEl);

  if (options.metaText) {
    const metaEl = document.createElement(options.metaTag || 'span');
    metaEl.className = options.metaClass || 'rail-recent-mode';
    if (options.metaLabel) {
      metaEl.setAttribute('aria-label', options.metaLabel);
      metaEl.title = options.metaLabel;
    }
    metaEl.textContent = options.metaText;
    openButton.appendChild(metaEl);
  }

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'rail-recent-del';
  deleteButton.dataset.action = options.deleteAction || 'delete';
  deleteButton.dataset.id = id;
  deleteButton.setAttribute('aria-label', options.deleteLabel || 'Delete');
  deleteButton.title = options.deleteLabel || 'Delete';
  deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';

  row.append(openButton, deleteButton);
  return row;
}

export { createRailRecentItem };
