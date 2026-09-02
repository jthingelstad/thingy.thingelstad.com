// Icons via lucide-react (tree-shaken components; replaced the
// lucide-static + innerHTML wrapper 2026-09-03). The string-name API is
// kept so call sites read as declarative markup.

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  LogOut,
  Mic,
  PanelLeft,
  Pencil,
  RotateCcw,
  Search,
  Share2,
  Square,
  SquarePen,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  UsersRound,
  X,
  type LucideIcon
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  'arrow-up': ArrowUp,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  copy: Copy,
  'log-out': LogOut,
  mic: Mic,
  'panel-left': PanelLeft,
  pencil: Pencil,
  'rotate-ccw': RotateCcw,
  search: Search,
  share: Share2,
  square: Square,
  'square-pen': SquarePen,
  'thumbs-down': ThumbsDown,
  'thumbs-up': ThumbsUp,
  trash: Trash2,
  'users-round': UsersRound,
  x: X
};

export function Icon({ name }: { name: string }) {
  const Component = ICONS[name];
  if (!Component) return null;
  return (
    <span aria-hidden="true">
      <Component />
    </span>
  );
}
