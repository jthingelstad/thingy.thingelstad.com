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
      <div className="mobile-chatbar-title">
        {canRename ? (
          <button
            type="button"
            className="thingy-title-edit"
            title="Rename conversation"
            onClick={() => {
              setDraft(title);
              setEditing(true);
            }}
          >
            {title}
          </button>
        ) : (
          <span>{title}</span>
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
    <div className="mobile-chatbar-title">
      <input
        className="thingy-title-input"
        type="text"
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
