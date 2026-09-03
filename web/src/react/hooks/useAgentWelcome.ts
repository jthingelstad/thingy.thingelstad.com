import { useEffect, useMemo, useState } from 'react';
import { librarianStreamUrl } from '../../shared/thingy-config.ts';
import { postJsonStream, read as readStream } from '../../shared/thingy-stream.ts';
import { AGENT_SETUP_TIMEOUT_MS } from '../../shared/thingy-timeouts.ts';
import { trackEvent } from '../../shared/thingy-analytics.ts';
import * as session from '../../shared/thingy-session.ts';

// Contract 4.10: the greeting is composed HERE, instantly, and never
// swapped once shown. ONE short display line - either a time-aware
// salutation phrase or an archive tease from the server's greeting_lines
// pool (grounded lines cached from the PREVIOUS /welcome response), like
// a librarian who was mid-thought when the reader walked in. These
// built-in teases only cover a device's very first open - keep them
// timeless (no counts that will drift stale).
const FALLBACK_LINES = [
  'A quarter century of writing is in here somewhere.',
  'I can trace one idea across the newsletter, the blog, and the podcast.',
  'The archive reaches back to 2000. Name a year.',
  'Jamie keeps writing about the same things - the fun part is finding out when.'
];

const GREETING_POOL_KEY = 'thingy_greeting_pool';

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

function salutationPhrase(name: string) {
  const hour = new Date().getHours();
  const timed = hour >= 5 && hour < 12 ? 'Morning' : hour >= 12 && hour < 18 ? 'Afternoon' : 'Evening';
  const named = name ? `, ${name}` : '';
  return pick([
    `${timed}${named}.`,
    `${timed}${named}. What shall we dig up?`,
    `Where to${named}?`,
    `Let's pull a thread${named}.`,
    `Something on your mind${named}?`
  ]);
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

function composeGreeting(guest: boolean): { text: string; subtext: string } {
  const pool = cachedGreetingLines();
  const tease = pick(pool.length ? pool : FALLBACK_LINES);
  if (guest) {
    // Identity as the display line, one archive tease muted below. Guest
    // mechanics (question allowance, sign-in pitch) are the guest BANNER's
    // job - repeating them here read as a wall of terms.
    return { text: "Hey - I'm Thingy.", subtext: tease };
  }
  const name = String(session.storedProfile().preferred_name || '').trim();
  // Half the opens are a warm salutation, half are Thingy holding up
  // something it found. One line either way, never both.
  return { text: pool.length && Math.random() < 0.5 ? tease : salutationPhrase(name), subtext: '' };
}

export function useAgentWelcome(guest: boolean, seeded: boolean) {
  // Composed once per mount; deliberately never replaced by server text -
  // the old swap-when-done behavior is exactly the latency Jamie saw.
  const greeting = useMemo(() => composeGreeting(guest), [guest]);
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
                .slice(0, 6)
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
  return { text: greeting.text, subtext: greeting.subtext, suggestions, suggestionsPending };
}
