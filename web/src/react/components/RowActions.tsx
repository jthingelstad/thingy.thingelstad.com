// Share / Rename / Delete for one conversation row, in the rail and in All
// chats (Jamie approved the touch version 2026-10-01).
//
// Two ways in, one set of actions:
//  - With a mouse, the three 44px icon buttons appear on hover or keyboard
//    focus (.thingy-row-actions, thingy-app-ui.css).
//  - Where nothing can hover (touch: `(hover: none), (pointer: coarse)`),
//    those can never be revealed, so the "More actions" button is always
//    shown instead and opens an action sheet - a real dialog: focus moves
//    in, Escape closes it, and focus returns to the button. Picking an
//    action closes the sheet first, puts focus back on the button, then
//    runs the action (whose own dialog returns focus there in turn).
//
// The row's <li> carries .thingy-row so the CSS can reveal its actions.

import { useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Icon } from './Icon.tsx';
import { Tip } from './Tip.tsx';
import { SHEET_CONTENT, SHEET_OVERLAY, SHEET_SAFE_BOTTOM, SheetGrab } from './Sheet.tsx';

export function shortDate(value?: string) {
  const time = Date.parse(String(value || ''));
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

type Action = 'share' | 'rename' | 'delete';

const VARIANTS = {
  rail: {
    hover: 'absolute inset-y-0 right-0 items-center rounded-r-xl bg-inherit',
    action:
      'grid size-11 place-items-center rounded-xl text-rail-icon transition-colors hover:bg-rail-active hover:text-white [&_svg]:size-4',
    danger: 'hover:text-oops',
    more: 'size-11 shrink-0 place-items-center rounded-xl text-rail-icon transition-colors hover:bg-rail-active hover:text-white aria-expanded:bg-rail-active aria-expanded:text-white [&_svg]:size-5'
  },
  paper: {
    hover: 'absolute top-1/2 right-1 -translate-y-1/2 items-center rounded-xl bg-inherit',
    action:
      'grid size-11 place-items-center rounded-xl text-meta transition-colors hover:bg-paper hover:text-ink [&_svg]:size-[18px]',
    danger: 'hover:text-danger',
    more: 'size-11 shrink-0 place-items-center rounded-xl border-2 border-transparent text-meta transition-colors hover:border-ink hover:bg-paper hover:text-ink aria-expanded:border-ink aria-expanded:bg-paper aria-expanded:text-ink [&_svg]:size-5'
  }
} as const;

export function RowActions({
  title,
  updatedAt,
  shared,
  variant,
  onShare,
  onRename,
  onDelete
}: {
  title: string;
  updatedAt?: string;
  shared: boolean;
  variant: keyof typeof VARIANTS;
  onShare: () => void;
  onRename: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const pending = useRef<Action | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const style = VARIANTS[variant];
  const shareLabel = shared ? 'Refresh share link' : 'Share';
  const run = { share: onShare, rename: onRename, delete: onDelete };

  const choose = (action: Action) => {
    pending.current = action;
    setOpen(false);
  };

  return (
    <>
      <span className={`thingy-row-actions ${style.hover}`}>
        <Tip label={shareLabel}>
          <button type="button" className={style.action} aria-label="Share" onClick={onShare}>
            <Icon name="share" />
          </button>
        </Tip>
        <Tip label="Rename">
          <button type="button" className={style.action} aria-label="Rename" onClick={onRename}>
            <Icon name="pencil" />
          </button>
        </Tip>
        <Tip label="Delete">
          <button type="button" className={`${style.action} ${style.danger}`} aria-label="Delete" onClick={onDelete}>
            <Icon name="trash" />
          </button>
        </Tip>
      </span>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Trigger asChild>
          <button
            ref={trigger}
            type="button"
            className={`thingy-row-more ${style.more}`}
            aria-label={`More actions for ${title}`}
          >
            <Icon name="ellipsis" />
          </button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className={SHEET_OVERLAY}>
            <Dialog.Content
              className={`thingy-action-sheet ${SHEET_CONTENT} w-[min(24rem,100%)] px-4 pt-4 pb-4 ${SHEET_SAFE_BOTTOM}`}
              aria-describedby={undefined}
              onCloseAutoFocus={(event) => {
                // Focus goes back to the button first, then the chosen
                // action runs, so its own dialog returns focus here too.
                event.preventDefault();
                trigger.current?.focus();
                const action = pending.current;
                pending.current = null;
                if (action) run[action]();
              }}
            >
              <SheetGrab />
              <div className="flex items-start gap-3 px-1 pb-2">
                <div className="min-w-0 flex-1 pt-1.5">
                  <Dialog.Title asChild>
                    <h2 className="thingy-modal-title truncate">
                      <span className="sr-only">Actions for </span>
                      {title}
                    </h2>
                  </Dialog.Title>
                  {updatedAt && shortDate(updatedAt) ? (
                    <p className="mt-1 font-mono text-[12.5px] text-meta">{shortDate(updatedAt)}</p>
                  ) : null}
                </div>
                <Dialog.Close asChild>
                  <button type="button" className="thingy-icon-btn -mr-1" aria-label="Close">
                    <Icon name="x" />
                  </button>
                </Dialog.Close>
              </div>
              <div className="grid gap-0.5 border-t-2 border-dashed border-rule pt-2">
                <button type="button" className="thingy-sheet-action" onClick={() => choose('share')}>
                  <span className="thingy-icon-tile" aria-hidden="true">
                    <Icon name={shared ? 'link' : 'share'} />
                  </span>
                  {shareLabel}
                </button>
                <button type="button" className="thingy-sheet-action" onClick={() => choose('rename')}>
                  <span className="thingy-icon-tile" aria-hidden="true">
                    <Icon name="pencil" />
                  </span>
                  Rename
                </button>
                <button
                  type="button"
                  className="thingy-sheet-action thingy-sheet-action-danger"
                  onClick={() => choose('delete')}
                >
                  <span className="thingy-icon-tile thingy-icon-tile-danger" aria-hidden="true">
                    <Icon name="trash" />
                  </span>
                  Delete
                </button>
              </div>
              <Dialog.Close asChild>
                <button type="button" className="thingy-btn thingy-btn-secondary mt-3 min-h-[52px] w-full">
                  Cancel
                </button>
              </Dialog.Close>
            </Dialog.Content>
          </Dialog.Overlay>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
