import { useEffect, useRef, useState } from 'react';
import { ComposerPrimitive, ThreadPrimitive, useAui, useAuiState } from '@assistant-ui/react';
import { createDictationController, speechInputSupported } from '../../shared/thingy-voice.ts';
import { trackEvent } from '../../shared/thingy-analytics.ts';
import { Icon } from './Icon.tsx';
import { Tip } from './Tip.tsx';

export const MAX_QUESTION_CHARS = 1200;

const ROUND_BUTTON = 'grid size-9 shrink-0 place-items-center rounded-full transition-colors [&_svg]:size-[18px]';

export function Composer({ guest }: { guest: boolean }) {
  const aui = useAui();
  const text = useAuiState((state) => state.composer.text);
  const textRef = useRef('');
  textRef.current = text;
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
    <div className="thingy-composer-zone mx-auto w-full max-w-3xl px-4 pb-4">
      <ComposerPrimitive.Root className="composer-box rounded-[26px] border border-line bg-surface shadow-[0_8px_30px_-12px_rgb(14_43_38/0.25)] transition-shadow focus-within:border-accent/60 focus-within:shadow-[0_10px_36px_-12px_rgb(14_43_38/0.35)]">
        <label htmlFor="librarian-question" className="sr-only">
          Ask Thingy
        </label>
        <ComposerPrimitive.Input
          id="librarian-question"
          className="thingy-aui-input max-h-[40dvh] min-h-6 w-full resize-none bg-transparent px-[18px] pt-3.5 pb-0.5 font-sans text-base leading-normal text-ink outline-none placeholder:text-muted"
          placeholder="Ask Thingy…"
          rows={1}
          maxLength={MAX_QUESTION_CHARS}
          autoFocus
        />
        <div className="flex items-center justify-between gap-2.5 py-2 pr-2.5 pl-3">
          <span className="flex min-w-0 items-center gap-2">
            {speechSupported ? (
              <Tip label={listening ? 'Stop voice input' : 'Ask by voice'}>
                <button
                  type="button"
                  className={`thingy-aui-mic ${ROUND_BUTTON} ${
                    listening
                      ? 'bg-error/10 text-error'
                      : 'border border-line-soft text-ink-soft hover:bg-surface-2 hover:text-ink'
                  }`}
                  aria-label={listening ? 'Stop voice input' : 'Ask by voice'}
                  aria-pressed={listening}
                  onClick={() => (listening ? dictationRef.current?.stop() : dictationRef.current?.start())}
                >
                  <Icon name="mic" />
                </button>
              </Tip>
            ) : null}
            <span className="truncate text-xs text-ink-soft" aria-live="polite">
              {voiceStatus || (guest ? 'Guest preview' : '')}
            </span>
          </span>
          <span id="librarian-question-count" className={quiet ? 'hidden' : ''} aria-hidden="true">
            <span className="composer-count font-mono text-xs text-ink-soft tabular-nums">
              {text.length} / {MAX_QUESTION_CHARS}
            </span>
          </span>
          <ThreadPrimitive.If running={false}>
            <Tip label="Send">
              <ComposerPrimitive.Send asChild>
                <button
                  type="button"
                  className={`composer-send ${ROUND_BUTTON} bg-accent-deep text-bg hover:brightness-110 disabled:cursor-default disabled:bg-surface-2 disabled:text-muted`}
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
                  className={`composer-send thingy-aui-stop ${ROUND_BUTTON} bg-ink text-bg hover:brightness-125 [&_svg]:size-3.5 [&_svg]:fill-current`}
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
