// Copy buttons on /connect/: progressive enhancement over plain code. The
// buttons ship inside hidden ticket stubs and appear only when this module
// runs and the async clipboard API exists, so a page without JavaScript (or
// without clipboard access) shows the URL and command as selectable text.
// A press copies the ticket's code, flips the button to "Copied!" for two
// seconds and announces through the page's sr-only status region.

export const COPIED_MS = 2000;

interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

export function wireCopyButtons(
  root: ParentNode = document,
  clipboard: ClipboardLike | null | undefined = globalThis.navigator?.clipboard
): number {
  if (!clipboard || typeof clipboard.writeText !== 'function') return 0;
  const status = root.querySelector<HTMLElement>('#thingy-copy-status');
  let wired = 0;
  for (const ticket of root.querySelectorAll<HTMLElement>('.thingy-ticket')) {
    const code = ticket.querySelector('code');
    const stub = ticket.querySelector<HTMLElement>('.thingy-ticket-stub');
    const button = ticket.querySelector<HTMLButtonElement>('.thingy-copy-btn');
    const label = ticket.querySelector<HTMLElement>('.thingy-copy-label');
    if (!code || !stub || !button || !label) continue;
    let timer: ReturnType<typeof setTimeout> | undefined;
    button.addEventListener('click', async () => {
      try {
        await clipboard.writeText((code.textContent || '').trim());
      } catch {
        if (status) status.textContent = 'Could not copy. Select the text to copy it.';
        return;
      }
      clearTimeout(timer);
      label.textContent = 'Copied!';
      button.classList.add('is-copied');
      if (status) status.textContent = `Copied ${button.dataset.copyWhat || 'it'} to the clipboard`;
      timer = setTimeout(() => {
        label.textContent = 'Copy';
        button.classList.remove('is-copied');
        if (status) status.textContent = '';
      }, COPIED_MS);
    });
    stub.hidden = false;
    ticket.classList.add('has-copy');
    wired += 1;
  }
  return wired;
}
