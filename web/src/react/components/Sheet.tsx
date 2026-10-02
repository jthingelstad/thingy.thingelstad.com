// Dialog chrome shared by every in-app dialog (Felt & Tangerine, phase 3).
// Desktop: a centred paper modal. Phone (below md, 768px): the same dialog
// becomes a bottom sheet - full width, anchored to the bottom, rounded top,
// a decorative grab handle, internal scroll under a max height, and the
// home-indicator safe area below the last control. One component tree for
// both: only classes change, so focus management and Escape stay Radix's.

import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Icon } from './Icon.tsx';
import { ThingyFace, type ThingyFaceMood } from './ThingyFace.tsx';

/** The scrim. Centres the modal on desktop, drops it to the bottom on a phone. */
export const SHEET_OVERLAY =
  'thingy-scrim fixed inset-0 z-50 grid place-items-center overflow-y-auto p-5 max-md:items-end max-md:justify-items-stretch max-md:overflow-hidden max-md:p-0 max-md:pt-4';

/** The paper panel. Pair with a width and a max height for desktop. */
export const SHEET_CONTENT =
  'thingy-modal thingy-sheet flex flex-col font-sans outline-none max-md:max-h-[calc(100dvh-1rem)] max-md:w-full max-md:max-w-none max-md:rounded-t-[24px] max-md:rounded-b-none max-md:border-b-0 max-md:pt-2.5 max-md:shadow-none';

/** Bottom padding that clears the home indicator on a phone. */
export const SHEET_SAFE_BOTTOM = 'max-md:pb-[calc(1.25rem+env(safe-area-inset-bottom))]';

/** Footer buttons: a row on desktop, stacked full width on a phone with the
 *  primary on top (markup order is secondary first, primary last). */
export const SHEET_FOOTER =
  'flex flex-wrap items-center justify-end gap-2.5 max-md:flex-col-reverse max-md:items-stretch max-md:[&>*]:w-full';

export function SheetGrab() {
  return <span className="thingy-sheet-grab" aria-hidden="true" />;
}

export type DialogMark =
  { icon: string; danger?: boolean; face?: undefined } | { face: ThingyFaceMood; icon?: undefined; danger?: undefined };

export function DialogMarkTile({ mark }: { mark: DialogMark }) {
  if (mark.face) return <ThingyFace className="thingy-dialog-face shrink-0" mood={mark.face} size={54} />;
  return (
    <span
      className={`thingy-icon-tile thingy-dialog-icon${mark.danger ? ' thingy-icon-tile-danger' : ''}`}
      aria-hidden="true"
    >
      <Icon name={mark.icon} />
    </span>
  );
}

/**
 * The dialog header: an optional icon tile or face, the Archivo title, an
 * optional subline, and the 44px close. The title is the dialog's
 * accessible name (Dialog.Title).
 */
export function DialogHeader({
  title,
  titleClassName = '',
  subtitle,
  mark,
  closeLabel = 'Close',
  className = ''
}: {
  title: ReactNode;
  titleClassName?: string;
  subtitle?: ReactNode;
  mark?: DialogMark;
  closeLabel?: string;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3.5 ${className}`}>
      {mark ? <DialogMarkTile mark={mark} /> : null}
      <div className="min-w-0 flex-1">
        <Dialog.Title asChild>
          <h2 className={`thingy-modal-title ${titleClassName}`}>{title}</h2>
        </Dialog.Title>
        {subtitle ? <p className="mt-1 text-[14px] leading-snug text-meta">{subtitle}</p> : null}
      </div>
      <Dialog.Close asChild>
        <button type="button" className="thingy-icon-btn -mr-1.5 self-start" aria-label={closeLabel}>
          <Icon name="x" />
        </button>
      </Dialog.Close>
    </div>
  );
}
