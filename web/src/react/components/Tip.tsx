// Keyboard-accessible tooltips on Radix (2026-09-03), replacing bare
// title attributes on icon-only buttons. Mount TipProvider once near the
// app root; wrap a control in <Tip label="...">.

import type { ReactNode } from 'react';
import * as Tooltip from '@radix-ui/react-tooltip';

export function TipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={350} skipDelayDuration={200}>
      {children}
    </Tooltip.Provider>
  );
}

export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="thingy-tip" side="top" sideOffset={6} collisionPadding={8}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
