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
  // Corpus-grounded follow-up chips (contract 4.4): the welcome agent
  // retrieves real archive passages and grounds each suggestion in one.
  // Never a static question list - Jamie's product rule.
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // Seeded prompts skip the welcome request entirely - the chip
  // skeletons must not pulse for a request that will never run (R3-03).
  const [suggestionsPending, setSuggestionsPending] = useState(!seeded);
  useEffect(() => {
    if (seeded) return undefined;
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
            client_context: guest ? {} : userLocalContext(),
            user_profile: guest ? {} : { preferred_name: String(session.storedProfile().preferred_name || '') }
          }
        });
        let text = '';
        await readStream(response, (eventName, data) => {
          if (eventName === 'answer_delta') {
            // Buffer, don't render: streaming the welcome delta-by-delta
            // grew the centered empty state line by line and pushed the
            // suggestion chips/composer under the pointer (observed
            // mis-click, twice). One swap when the text is final.
            text += String(data.delta || '');
          } else if (eventName === 'answer') {
            text = String(data.answer || text);
            setWelcomeText(text || DEFAULT_WELCOME);
          } else if (eventName === 'done') {
            if (text) setWelcomeText(text);
          } else if (eventName === 'suggestions') {
            const list = Array.isArray(data.suggestions) ? data.suggestions : [];
            setSuggestions(
              list
                .map((entry) => String(entry || '').trim())
                .filter(Boolean)
                .slice(0, 3)
            );
          }
        });
        trackEvent('librarian.welcome_success', guest ? 'guest' : 'reader');
      } catch {
        trackEvent('librarian.welcome_error', 'client');
      } finally {
        setSuggestionsPending(false);
      }
    })();
    return () => controller.abort();
    // One welcome per page load.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { text: welcomeText, suggestions, suggestionsPending };
}
