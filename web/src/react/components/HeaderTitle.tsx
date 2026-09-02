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
            className="max-w-full cursor-text truncate rounded-md px-1.5 py-0.5 font-sans text-[15px] font-bold text-ink hover:bg-surface-2"
            title="Rename conversation"
            onClick={() => {
              setDraft(title);
              setEditing(true);
            }}
          >
            {title}
          </button>
        ) : (
          <span className="truncate font-sans text-[15px] font-bold text-ink">{title}</span>
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
        className="w-[min(420px,100%)] rounded-md border border-accent bg-surface px-1.5 py-0.5 font-sans text-[15px] font-bold text-ink outline-none"
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
