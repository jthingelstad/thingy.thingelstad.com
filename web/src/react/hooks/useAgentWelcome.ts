import { useEffect, useMemo, useState } from 'react';
import { librarianStreamUrl } from '../../shared/thingy-config.ts';
import { postJsonStream, read as readStream } from '../../shared/thingy-stream.ts';
import { AGENT_SETUP_TIMEOUT_MS } from '../../shared/thingy-timeouts.ts';
import { trackEvent } from '../../shared/thingy-analytics.ts';
import * as session from '../../shared/thingy-session.ts';

// Contract 4.10: the greeting is composed HERE, instantly, and never
// swapped once shown - a time-aware salutation plus one archive-flavored
// line. The server's greeting_lines (grounded in real corpus passages)
// arrive with the suggestions event and are cached for the NEXT open, so
// every open after the first draws from Thingy-native material at zero
// latency. These built-ins only cover the very first open on a device -
// keep them timeless (no counts that will drift stale).
const FALLBACK_LINES = [
  "There's a quarter century of writing in here - ask me to pull on any thread.",
  'Newsletter, blog, and podcast - I can trace an idea across all three.',
  'Ask me to compare eras - the archive reaches back to 2000.',
  "I can connect what Jamie wrote years apart - name a topic and I'll trace it."
];

const GREETING_POOL_KEY = 'thingy_greeting_pool';

function salutation() {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function cachedGreetingLines(): string[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(GREETING_POOL_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map((entry) => String(entry || '')).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function cacheGreetingLines(lines: string[]) {
  try {
    if (lines.length) window.localStorage.setItem(GREETING_POOL_KEY, JSON.stringify(lines.slice(0, 6)));
  } catch {
    /* storage denied: next open uses the fallbacks */
  }
}

function composeGreeting(guest: boolean) {
  const pool = cachedGreetingLines();
  const line = (pool.length ? pool : FALLBACK_LINES)[
    Math.floor(Math.random() * (pool.length ? pool.length : FALLBACK_LINES.length))
  ];
  if (guest) {
    // Identity plus one archive hook. Guest mechanics (question allowance,
    // sign-in pitch) are the guest BANNER's job - repeating them here read
    // as a wall of terms on what should be an invitation.
    return `${salutation()} - I'm Thingy, Jamie Thingelstad's archive agent. ${line}`;
  }
  const name = String(session.storedProfile().preferred_name || '').trim();
  return `${salutation()}${name ? `, ${name}` : ''}. ${line}`;
}

export function useAgentWelcome(guest: boolean, seeded: boolean) {
  // Composed once per mount; deliberately never replaced by server text -
  // the old swap-when-done behavior is exactly the latency Jamie saw.
  const welcomeText = useMemo(() => composeGreeting(guest), [guest]);
  // Corpus-grounded follow-up chips (contract 4.4): the welcome set
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
          payload: { scope: 'all', mode: 'thingy' }
        });
        await readStream(response, (eventName, data) => {
          if (eventName === 'suggestions') {
            const list = Array.isArray(data.suggestions) ? data.suggestions : [];
            setSuggestions(
              list
                .map((entry) => String(entry || '').trim())
                .filter(Boolean)
                .slice(0, 3)
            );
            const lines = Array.isArray((data as { greeting_lines?: unknown[] }).greeting_lines)
              ? ((data as { greeting_lines: unknown[] }).greeting_lines as unknown[])
                  .map((entry) => String(entry || '').trim())
                  .filter(Boolean)
              : [];
            cacheGreetingLines(lines);
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
