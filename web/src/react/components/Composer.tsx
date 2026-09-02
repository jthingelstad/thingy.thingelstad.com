import { useEffect, useRef, useState } from 'react';
import { ComposerPrimitive, ThreadPrimitive, useAui, useAuiState } from '@assistant-ui/react';
import { createDictationController, speechInputSupported } from '../../shared/thingy-voice.ts';
import { trackEvent } from '../../shared/thingy-analytics.ts';
import { Icon } from './Icon.tsx';

export const MAX_QUESTION_CHARS = 1200;

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
  return (
    <div className="thingy-composer-zone">
      <ComposerPrimitive.Root className="librarian-form librarian-question-form thingy-input composer-box">
        <label htmlFor="librarian-question" className="sr-only">
          Ask Thingy
        </label>
        <ComposerPrimitive.Input
          id="librarian-question"
          className="thingy-aui-input"
          placeholder="Ask Thingy…"
          rows={1}
          maxLength={MAX_QUESTION_CHARS}
          autoFocus
        />
        <div className="thingy-aui-composer-row">
          <span className="thingy-aui-composer-left">
            {speechSupported ? (
              <button
                type="button"
                className={`thingy-aui-mic${listening ? ' is-listening' : ''}`}
                aria-label={listening ? 'Stop voice input' : 'Ask by voice'}
                aria-pressed={listening}
                title={listening ? 'Stop voice input' : 'Ask by voice'}
                onClick={() => (listening ? dictationRef.current?.stop() : dictationRef.current?.start())}
              >
                <Icon name="mic" />
              </button>
            ) : null}
            <span className="thingy-aui-composer-hint" aria-live="polite">
              {voiceStatus || (guest ? 'Guest preview' : '')}
            </span>
          </span>
          <span
            id="librarian-question-count"
            className={`thingy-aui-count${text.length < 1000 ? ' is-quiet' : ''}`}
            aria-hidden="true"
          >
            <span className="composer-count">
              {text.length} / {MAX_QUESTION_CHARS}
            </span>
          </span>
          <ThreadPrimitive.If running={false}>
            <ComposerPrimitive.Send asChild>
              <button type="button" className="composer-send" aria-label="Ask Thingy">
                <Icon name="arrow-up" />
              </button>
            </ComposerPrimitive.Send>
          </ThreadPrimitive.If>
          <ThreadPrimitive.If running>
            <ComposerPrimitive.Cancel asChild>
              <button type="button" className="composer-send thingy-aui-stop" aria-label="Stop answering" title="Stop">
                <Icon name="square" />
              </button>
            </ComposerPrimitive.Cancel>
          </ThreadPrimitive.If>
        </div>
      </ComposerPrimitive.Root>
    </div>
  );
}
