import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../styles/thingy.css';
import '../styles/thingy-aui.css';
import { registerClientErrorTracking } from '../shared/thingy-analytics.ts';
import { composeExplorePrompt } from '../shared/thingy-explore.ts';
import { resolveFromValue } from '../shared/thingy-from.ts';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.ts';
import { bootWebMcp } from '../shared/thingy-webmcp.ts';
import * as session from '../shared/thingy-session.ts';
import { ChatApp, type ChatInitial } from './ChatApp.tsx';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } }
});
import { initTheme } from '../shared/thingy-theme.ts';

initTheme();

registerClientErrorTracking('chat');

// URL params are read BEFORE loadTinylytics scrubs them (same rule the
// page-entry-order test enforces for every chat entry).
const params = new URLSearchParams(window.location.search);
const explore = composeExplorePrompt(params.get('explore'), params.get('issue'));
const initial: ChatInitial = {
  prompt: (String(params.get('prompt') || '').trim() || explore.prompt).slice(0, 1200),
  from: resolveFromValue(params.get('from') || explore.sourceUrl || null)
};
const loginToken = String(params.get('login_token') || params.get('magic_token') || '').trim();
const email = session.normalizeEmail(params.get('email'));

if (loginToken || email) {
  // Sign-in intents keep their existing flow.
  window.location.href = session.signInUrl('/chat/');
} else {
  const host = document.getElementById('thingy-react-root');
  if (host)
    createRoot(host).render(
      <QueryClientProvider client={queryClient}>
        <ChatApp initial={initial} />
      </QueryClientProvider>
    );
}
loadTinylytics();
void bootWebMcp();
