import { useEffect, useRef, useState } from 'react';
import { ComposerPrimitive, ThreadPrimitive, useAui, useAuiState } from '@assistant-ui/react';
import { createDictationController, speechInputSupported } from '../../shared/thingy-voice.ts';
import { trackEvent } from '../../shared/thingy-analytics.ts';
import { Icon } from './Icon.tsx';
import { Tip } from './Tip.tsx';

export const MAX_QUESTION_CHARS = 1200;

// Felt & Tangerine composer: paper box, 2px ink border, hard shadow; a
// 48px tangerine send (navy icon) and a 44px mic. No mic ring: the
// board's #D9CBA8 ring is 1.55:1 on paper, under the 3:1 a control
// boundary needs, and the button reads fine as a bare icon.
const ROUND_BUTTON = 'grid shrink-0 place-items-center rounded-full transition-colors';
const SEND_BUTTON = `${ROUND_BUTTON} size-12 border-2 border-ink [&_svg]:size-[21px]`;

export function Composer({
  guest,
  locked = false,
  draftKey = ''
}: {
  guest: boolean;
  locked?: boolean;
  draftKey?: string;
}) {
  const aui = useAui();
  const text = useAuiState((state) => state.composer.text);
  const textRef = useRef('');
  textRef.current = text;
  // Per-conversation drafts: switching conversations remounts the thread
  // and used to wipe whatever was typed. sessionStorage keeps it for the
  // tab's lifetime without persisting reader text durably.
  const storageKey = draftKey ? `thingyDraft:${draftKey}` : '';
  // A first turn starts under the stable 'new' key and the server then
  // assigns the conversation id: migrate the draft to the id-keyed slot
  // so it stays with THIS conversation instead of resurfacing in the
  // next New chat (QA F03). Only 'new' migrates - switching between
  // conversations must never move drafts across them.
  const prevStorageKeyRef = useRef(storageKey);
  useEffect(() => {
    const previous = prevStorageKeyRef.current;
    prevStorageKeyRef.current = storageKey;
    if (!storageKey || previous === storageKey || previous !== 'thingyDraft:new') return;
    try {
      const pending = window.sessionStorage.getItem(previous);
      if (pending && !window.sessionStorage.getItem(storageKey)) {
        window.sessionStorage.setItem(storageKey, pending);
      }
      window.sessionStorage.removeItem(previous);
    } catch {
      /* private browsing */
    }
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey) return;
    if (!textRef.current) {
      try {
        const draft = window.sessionStorage.getItem(storageKey);
        if (draft) aui.composer.setText(draft);
      } catch {
        /* private browsing */
      }
    }
    // Restore once per mount.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    if (!storageKey) return;
    try {
      if (text) window.sessionStorage.setItem(storageKey, text);
      else window.sessionStorage.removeItem(storageKey);
    } catch {
      /* private browsing */
    }
  }, [storageKey, text]);
  // Offline awareness: a send while offline just produced a generic
  // error banner after the fact.
  const [offline, setOffline] = useState(() => !window.navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  // iOS Safari scrolls the WINDOW to keep a focused field above the
  // keyboard, even though both shells pin the document (overflow hidden).
  // A normal blur scrolls it back; disabling the focused field does not -
  // the guest lock lands on the last question's meta event, mid-answer,
  // with the keyboard still up, and left the shared page stuck scrolled
  // with a keyboard-sized blank under the composer (2026-10-01). The
  // document must never be offset once the field lets go of focus.
  useEffect(() => {
    const viewport = window.visualViewport;
    const unscroll = () => {
      if (document.activeElement?.id === 'librarian-question') return;
      if (window.scrollX || window.scrollY) window.scrollTo(0, 0);
    };
    viewport?.addEventListener('resize', unscroll);
    window.addEventListener('focusout', unscroll);
    let timer = 0;
    if (locked) {
      const input = document.getElementById('librarian-question');
      if (input && document.activeElement === input) input.blur();
      unscroll();
      // The keyboard animates closed after the lock; settle once it has.
      timer = window.setTimeout(unscroll, 500);
    }
    return () => {
      viewport?.removeEventListener('resize', unscroll);
      window.removeEventListener('focusout', unscroll);
      window.clearTimeout(timer);
    };
  }, [locked]);
  const [listening, setListening] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState('');
  const dictationRef = useRef<ReturnType<typeof createDictationController> | null>(null);
  const speechSupported = speechInputSupported();
  useEffect(() => {
    if (!speechSupported) return undefined;
    dictationRef.current = createDictationController({
      maxChars: MAX_QUESTION_CHARS,
      getText: () => textRef.current,
      onText: (value) => aui.composer.setText(value),
      onStatus: setVoiceStatus,
      onListeningChange: setListening,
      onTrack: (name, value) => trackEvent(name, value)
    });
    return () => {
      dictationRef.current?.dispose();
      dictationRef.current = null;
    };
    // Dictation owns a SpeechRecognition instance for the composer's life.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const quiet = text.length < 1000;
  return (
    <div className="thingy-composer-zone mx-auto w-full max-w-[808px] px-3 pt-2.5 pb-[max(1.125rem,env(safe-area-inset-bottom))] md:px-6 md:pb-8">
      {offline ? (
        <p
          className="mb-2 rounded-xl border-2 border-rule bg-toy px-3 py-2 text-center text-[13px] text-ink"
          role="status"
        >
          You&rsquo;re offline &mdash; Thingy needs a connection to answer.
        </p>
      ) : null}
      <ComposerPrimitive.Root className="composer-box rounded-[24px] border-2 border-ink bg-paper shadow-[0_5px_0_var(--thingy-ink)] focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-(--thingy-focus) md:rounded-[26px] md:shadow-[0_6px_0_var(--thingy-ink)]">
        <label htmlFor="librarian-question" className="sr-only">
          Ask Thingy
        </label>
        <ComposerPrimitive.Input
          id="librarian-question"
          className="thingy-aui-input max-h-[40dvh] min-h-6 w-full resize-none bg-transparent px-[18px] pt-3.5 pb-0.5 font-sans text-base leading-normal text-ink outline-none placeholder:text-(--thingy-placeholder) disabled:cursor-not-allowed md:px-[22px] md:pt-4 md:text-[17px]"
          placeholder={locked ? 'Guest limit reached — sign in free to keep asking' : 'Ask Thingy…'}
          rows={1}
          maxLength={MAX_QUESTION_CHARS}
          autoFocus
          disabled={locked}
        />
        <div className="flex items-center justify-between gap-2.5 py-2 pr-2 pl-2.5 md:pr-3 md:pb-3 md:pl-3.5">
          <span className="flex min-w-0 items-center gap-2">
            {speechSupported ? (
              <Tip label={listening ? 'Stop voice input' : 'Ask by voice'}>
                <button
                  type="button"
                  className={`thingy-aui-mic ${ROUND_BUTTON} size-11 [&_svg]:size-[19px] ${
                    listening ? 'bg-danger-tint text-danger' : 'text-ink hover:bg-toy'
                  }`}
                  aria-label={listening ? 'Stop voice input' : 'Ask by voice'}
                  aria-pressed={listening}
                  onClick={() => (listening ? dictationRef.current?.stop() : dictationRef.current?.start())}
                >
                  <Icon name="mic" />
                </button>
              </Tip>
            ) : null}
            <span className="flex min-w-0 items-center gap-2" aria-live="polite">
              {voiceStatus ? (
                <span className="truncate text-[13px] text-quiet">{voiceStatus}</span>
              ) : guest ? (
                <>
                  <span className="thingy-polka size-4 shrink-0 rounded-[5px] border-2 border-ink" aria-hidden="true" />
                  <span className="truncate font-mono text-[11px] font-semibold tracking-[0.14em] text-meta uppercase">
                    Guest preview
                  </span>
                </>
              ) : null}
            </span>
          </span>
          <span id="librarian-question-count" className={quiet ? 'hidden' : ''} aria-hidden="true">
            <span className="composer-count font-mono text-xs text-quiet tabular-nums">
              {text.length} / {MAX_QUESTION_CHARS}
            </span>
          </span>
          <ThreadPrimitive.If running={false}>
            <Tip label="Send">
              <ComposerPrimitive.Send asChild>
                <button
                  type="button"
                  className={`composer-send ${SEND_BUTTON} bg-tangerine text-on-tangerine shadow-[0_3px_0_var(--thingy-ink)] hover:brightness-105 disabled:cursor-default disabled:border-rule disabled:bg-toy disabled:text-quiet disabled:shadow-none`}
                  aria-label="Ask Thingy"
                >
                  <Icon name="arrow-up" />
                </button>
              </ComposerPrimitive.Send>
            </Tip>
          </ThreadPrimitive.If>
          <ThreadPrimitive.If running>
            <Tip label="Stop answering">
              <ComposerPrimitive.Cancel asChild>
                <button
                  type="button"
                  className={`composer-send thingy-aui-stop ${SEND_BUTTON} bg-ink text-bg shadow-[0_3px_0_var(--thingy-ink)] hover:brightness-125 [&_svg]:size-4 [&_svg]:fill-current`}
                  aria-label="Stop answering"
                >
                  <Icon name="square" />
                </button>
              </ComposerPrimitive.Cancel>
            </Tip>
          </ThreadPrimitive.If>
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
}
