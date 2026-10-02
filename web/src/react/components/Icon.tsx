// Icons via lucide-react (tree-shaken components; replaced the
// lucide-static + innerHTML wrapper 2026-09-03). The string-name API is
// kept so call sites read as declarative markup.

import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Ellipsis,
  History,
  Link,
  LogOut,
  MessagesSquare,
  Mic,
  PanelLeft,
  Pencil,
  Plug,
  RotateCcw,
  ScrollText,
  Search,
  Share2,
  Shuffle,
  Square,
  SquarePen,
  Star,
  ThumbsDown,
  ThumbsUp,
  TriangleAlert,
  Trash2,
  UsersRound,
  X,
  type LucideIcon
} from 'lucide-react';

const ICONS = {
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'arrow-up': ArrowUp,
  check: Check,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  copy: Copy,
  ellipsis: Ellipsis,
  history: History,
  link: Link,
  'log-out': LogOut,
  'messages-square': MessagesSquare,
  mic: Mic,
  'panel-left': PanelLeft,
  pencil: Pencil,
  plug: Plug,
  'rotate-ccw': RotateCcw,
  'scroll-text': ScrollText,
  search: Search,
  share: Share2,
  shuffle: Shuffle,
  square: Square,
  'square-pen': SquarePen,
  star: Star,
  'thumbs-down': ThumbsDown,
  'thumbs-up': ThumbsUp,
  'triangle-alert': TriangleAlert,
  trash: Trash2,
  'users-round': UsersRound,
  x: X
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

export function Icon({ name }: { name: IconName | (string & {}) }) {
  const Component = (ICONS as Record<string, LucideIcon>)[name];
  if (!Component) return null;
  return (
    <span aria-hidden="true">
      <Component />
    </span>
  );
}
