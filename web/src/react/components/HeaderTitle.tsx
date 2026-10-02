import { useState } from 'react';

// Click-to-edit conversation title in the header (Claude convention).
export function HeaderTitle({
  title,
  canRename,
  onRename
}: {
  title: string;
  canRename: boolean;
  onRename: (title: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  if (!editing || !canRename) {
    return (
      <div className="mobile-chatbar-title min-w-0 flex-1 text-center md:text-left">
        {canRename ? (
          <button
            type="button"
            className="min-h-11 max-w-full cursor-text truncate rounded-[10px] px-2.5 font-sans text-base font-bold text-ink hover:bg-toy"
            title="Rename conversation"
            onClick={() => {
              setDraft(title);
              setEditing(true);
            }}
          >
            {title}
          </button>
        ) : (
          <span className="truncate px-2.5 font-sans text-base font-bold text-ink">{title}</span>
        )}
      </div>
    );
  }
  const commit = () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== title) void onRename(next);
  };
  return (
    <div className="mobile-chatbar-title min-w-0 flex-1">
      <input
        className="min-h-11 w-[min(420px,100%)] rounded-[10px] border-2 border-ink bg-paper px-2.5 font-sans text-base font-bold text-ink outline-none focus:outline-3 focus:outline-offset-2 focus:outline-[var(--thingy-focus)]"
        type="text"
        aria-label="Conversation title"
        value={draft}
        maxLength={120}
        autoFocus
        onChange={(event) => setDraft(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
          if (event.key === 'Escape') setEditing(false);
        }}
      />
    </div>
  );
}
