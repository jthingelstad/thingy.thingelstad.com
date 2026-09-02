import { type JSX, type RefObject } from 'preact';
import { useRef, useState } from 'preact/hooks';
import { useSignalEffect } from '@preact/signals';
import { answerInFlight } from '../stores/chat-store.ts';
import { modeClass, modeIcon } from '../thingy-modes.ts';
import { ChatMessages } from './ChatMessages.tsx';
import { ComposerCount } from './ComposerCount.tsx';
import { ComposerSubmit } from './ComposerSubmit.tsx';
import { MobileChatBar } from './ChatNavigation.tsx';
import { ThingyIcon } from './ThingyIcon.tsx';

interface ChatConversationViewProps {
  chatPanelRef: RefObject<HTMLDivElement>;
  scrollRef: RefObject<HTMLDivElement>;
  composerRef: RefObject<HTMLDivElement>;
  inputRef: RefObject<HTMLTextAreaElement>;
  mobileOpen: boolean;
  mobileMenuOpen: boolean;
  conversationTitle: string;
  busy: boolean;
  hasActiveConversation: boolean;
  from: { href: string; name: string } | null;
  signedIn: boolean;
  guest: boolean;
  guestRemaining: number | null;
  signInHref: string;
  showModeBanner: boolean;
  currentMode: string;
  modeLabel: (mode: string) => string;
  currentText: string;
  maxQuestionChars: number;
  dictationListening: boolean;
  speechSupported: boolean;
  voiceStatus: string;
  onToggleMobileRail: () => void;
  onNewConversation: () => void;
  onToggleMobileMenu: () => void;
  onRename: () => void;
  onDelete: () => void;
  onShare: () => void;
  onUnshare: () => void;
  shared: boolean;
  onScroll: () => void;
  onRetry: (messageId: string, prompt: string) => void;
  submitFeedback: (input: { requestId: string; reaction: string; comment: string }) => Promise<ThingyApiResponse>;
  track: (name: string, value?: string) => void;
  onSubmit: (event: JSX.TargetedSubmitEvent<HTMLFormElement>) => void;
  onQuestionInput: (value: string) => void;
  onDictation: () => void;
  onStopAnswer: () => void;
}

// Screen-reader status line for the streaming answer. The message list
// itself is not a live region (announcing every streamed token re-reads the
// whole growing answer); instead this hidden element announces only the
// state transitions.
function AnswerLiveStatus() {
  const [status, setStatus] = useState('');
  const wasInFlight = useRef(false);
  useSignalEffect(() => {
    const inFlight = answerInFlight.value;
    if (inFlight === wasInFlight.current) return;
    wasInFlight.current = inFlight;
    setStatus(inFlight ? 'Thingy is answering…' : 'Answer ready');
  });
  return (
    <p class="sr-only" role="status" aria-live="polite">
      {status}
    </p>
  );
}

function ChatConversationView(props: ChatConversationViewProps) {
  return (
    <section class="thingy-conversation" aria-label="Thingy chat">
      <h1 class="sr-only">Thingy chat</h1>
      <MobileChatBar
        mobileOpen={props.mobileOpen}
        conversationTitle={props.conversationTitle}
        busy={props.busy}
        hasActiveConversation={props.hasActiveConversation}
        menuOpen={props.mobileMenuOpen}
        onToggleRail={props.onToggleMobileRail}
        onNewConversation={props.onNewConversation}
        onToggleMenu={props.onToggleMobileMenu}
        onRename={props.onRename}
        onDelete={props.onDelete}
        onShare={props.onShare}
        onUnshare={props.onUnshare}
        shared={props.shared}
      />

      {props.guest ? (
        <aside class="thingy-guest-banner" aria-label="Guest preview">
          <span>
            {props.guestRemaining === 0
              ? "You've used today's guest questions."
              : typeof props.guestRemaining === 'number'
                ? `Guest preview — ${props.guestRemaining} question${props.guestRemaining === 1 ? '' : 's'} left today.`
                : 'Guest preview — ask a few questions, no account needed.'}
          </span>
          <a href={props.signInHref} data-tinylytics-event="librarian.guest_signin_click">
            Sign in free for more
          </a>
        </aside>
      ) : null}

      {props.from ? (
        <a class="return-chip" href={props.from.href} data-tinylytics-event="network.return">
          <ThingyIcon name="arrow-left" />
          <span>
            Return to <strong>{props.from.name}</strong>
          </span>
        </a>
      ) : null}

      <div ref={props.chatPanelRef} class="librarian-chat thingy-chat" hidden={!props.signedIn}>
        <div ref={props.scrollRef} class="thingy-chat-scroll" onScroll={props.onScroll}>
          {props.showModeBanner ? (
            <div
              class="thingy-mode-banner"
              data-mode={modeClass(props.currentMode)}
              aria-live="polite"
              aria-label={`${props.modeLabel(props.currentMode)} mode`}
            >
              <span class="thingy-mode-banner-icon">
                <ThingyIcon name={modeIcon(props.currentMode)} />
              </span>
              <span>{props.modeLabel(props.currentMode)}</span>
            </div>
          ) : null}
          <AnswerLiveStatus />
          <div class="librarian-messages">
            <ChatMessages
              scrollContainer={() => props.scrollRef.current}
              onRetry={props.onRetry}
              submitFeedback={props.submitFeedback}
              track={props.track}
            />
          </div>
        </div>

        <div ref={props.composerRef} class="thingy-composer-zone">
          <form
            class={`librarian-form librarian-question-form thingy-input composer-box${props.busy ? ' is-busy' : ''}`}
            onSubmit={props.onSubmit}
          >
            <label for="librarian-question" class="sr-only">
              Ask Thingy
            </label>
            <textarea
              ref={props.inputRef}
              id="librarian-question"
              name="message"
              rows={1}
              required
              maxLength={props.maxQuestionChars}
              value={props.currentText}
              placeholder="Ask Thingy…"
              aria-describedby="librarian-question-count thingy-ai-note"
              onInput={(event) => props.onQuestionInput(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }}
            />
            <div class="composer-toolbar">
              <button
                class={`composer-voice${props.dictationListening ? ' is-listening' : ''}`}
                type="button"
                disabled={!props.speechSupported || (props.busy && !props.dictationListening)}
                aria-pressed={props.dictationListening}
                aria-label={
                  !props.speechSupported
                    ? 'Speech input not supported'
                    : props.dictationListening
                      ? 'Stop dictation'
                      : 'Dictate prompt'
                }
                title={
                  !props.speechSupported
                    ? 'Speech input not supported in this browser'
                    : props.dictationListening
                      ? 'Stop dictation'
                      : 'Dictate prompt'
                }
                onClick={props.onDictation}
              >
                <ThingyIcon name="mic" />
              </button>
              <span class="composer-voice-status" aria-live="polite">
                {props.voiceStatus}
              </span>
              <span class="composer-spacer" />
              <span id="librarian-question-count">
                <ComposerCount maxChars={props.maxQuestionChars} />
              </span>
              <ComposerSubmit maxChars={props.maxQuestionChars} onStop={props.onStopAnswer} />
            </div>
          </form>
          <p class="thingy-ai-note" id="thingy-ai-note">
            Thingy is AI and can make mistakes. Please double-check responses.
          </p>
        </div>
      </div>
    </section>
  );
}

export { ChatConversationView };
