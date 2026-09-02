import { useEffect, useState } from 'react';
import { librarianStreamUrl } from '../../shared/thingy-config.ts';
import { postJsonStream, read as readStream } from '../../shared/thingy-stream.ts';
import { AGENT_SETUP_TIMEOUT_MS } from '../../shared/thingy-timeouts.ts';
import { userLocalContext } from '../../shared/thingy-local-context.ts';
import { trackEvent } from '../../shared/thingy-analytics.ts';
import * as session from '../../shared/thingy-session.ts';

const DEFAULT_WELCOME = "Hi. I'm Thingy. Ask me what you're curious about and I'll help you explore the archive.";
const GUEST_WELCOME =
  "Hi. I'm Thingy - ask me anything about Jamie Thingelstad's public archive: twenty-five years of blog posts, the Weekly Thing newsletter, and the Another Thing podcast. You can try a few questions as a guest; signing in is free for Weekly Thing readers.";

export function useAgentWelcome(guest: boolean, seeded: boolean) {
  const [welcomeText, setWelcomeText] = useState(guest ? GUEST_WELCOME : DEFAULT_WELCOME);
  useEffect(() => {
    if (guest || seeded) return undefined;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await postJsonStream({
          baseUrl: librarianStreamUrl(),
          path: '/welcome',
          controller,
          timeoutMs: AGENT_SETUP_TIMEOUT_MS,
          abortMessage: 'welcome timeout',
          headers: session.authHeaders(),
          payload: {
            scope: 'all',
            mode: 'thingy',
            client_context: userLocalContext(),
            user_profile: { preferred_name: String(session.storedProfile().preferred_name || '') }
          }
        });
        let text = '';
        await readStream(response, (eventName, data) => {
          if (eventName === 'answer_delta') {
            text += String(data.delta || '');
            setWelcomeText(text || DEFAULT_WELCOME);
          } else if (eventName === 'answer') {
            text = String(data.answer || text);
            setWelcomeText(text || DEFAULT_WELCOME);
          }
        });
        trackEvent('librarian.welcome_success');
      } catch {
        trackEvent('librarian.welcome_error', 'client');
      }
    })();
    return () => controller.abort();
    // One welcome per page load.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return welcomeText;
}
