import { type JSX, type RefObject } from 'preact';
import { type Signal } from '@preact/signals';
import { modeClass, modeIcon } from '../thingy-modes.ts';
import { AuthPanel } from './AuthPanel.tsx';
import { ChatMessages } from './ChatMessages.tsx';
import { ComposerCount } from './ComposerCount.tsx';
import { ComposerSubmit } from './ComposerSubmit.tsx';
import { MobileChatBar } from './ChatNavigation.tsx';
import { SourcePicker } from './SourcePicker.tsx';
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
  showModeBanner: boolean;
  currentMode: string;
  modeLabel: (mode: string) => string;
  currentText: string;
  maxQuestionChars: number;
  dictationListening: boolean;
  speechSupported: boolean;
  voiceStatus: string;
  canMapDraft: boolean;
  sourcesAvailable: boolean;
  selectedSources: Signal<string[]>;
  onToggleMobileRail: () => void;
  onNewConversation: () => void;
  onToggleMobileMenu: () => void;
  onRename: () => void;
  onDelete: () => void;
  onAuthSubmit: () => void;
  onAddSubscriber: () => void;
  onResendConfirmation: () => void;
  onAuthEmailInput: () => void;
  onScroll: () => void;
  onRetry: (messageId: string, prompt: string) => void;
  onEmbeddedPrompt: (prompt: string, kind: 'map' | 'experience') => void;
  submitFeedback: (input: { requestId: string; reaction: string; comment: string }) => Promise<ThingyApiResponse>;
  track: (name: string, value?: string) => void;
  onSubmit: (event: JSX.TargetedSubmitEvent<HTMLFormElement>) => void;
  onQuestionInput: (value: string) => void;
  onDictation: () => void;
  onMapSeed: (seed: string) => void;
  onScopeChange: (scope: string) => void;
  onStopAnswer: () => void;
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
      />

      {props.from ? (
        <a class="return-chip" href={props.from.href} data-tinylytics-event="network.return">
          <ThingyIcon name="arrow-left" />
          <span>
            Return to <strong>{props.from.name}</strong>
          </span>
        </a>
      ) : null}

      <div class="librarian-auth thingy-auth" hidden={props.signedIn}>
        <AuthPanel
          onSubmit={props.onAuthSubmit}
          onAddSubscriber={props.onAddSubscriber}
          onResendConfirmation={props.onResendConfirmation}
          onEmailInput={props.onAuthEmailInput}
        />
      </div>

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
          <div class="librarian-messages" aria-live="polite">
            <ChatMessages
              scrollContainer={() => props.scrollRef.current}
              onRetry={props.onRetry}
              onEmbeddedPrompt={props.onEmbeddedPrompt}
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
              placeholder="Ask Thingy, or seed a map…"
              aria-describedby="librarian-question-count librarian-source-error thingy-ai-note"
              onInput={(event) => props.onQuestionInput(event.currentTarget.value)}
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
              <button
                class="composer-map"
                type="button"
                disabled={props.busy || !props.canMapDraft}
                aria-label={props.canMapDraft ? 'Seed curiosity map with this text' : 'Type a topic to seed a map'}
                title={props.canMapDraft ? 'Seed curiosity map with this text' : 'Type a topic to seed a map'}
                onClick={() => props.onMapSeed(props.currentText.trim())}
              >
                <ThingyIcon name="network" />
                <span>Map</span>
              </button>
              <span class="composer-voice-status" aria-live="polite">
                {props.voiceStatus}
              </span>
              <SourcePicker
                selected={props.selectedSources}
                disabled={props.busy}
                scrollContainer={props.scrollRef.current}
                onChange={props.onScopeChange}
              />
              <span class="composer-spacer" />
              <span id="librarian-question-count">
                <ComposerCount maxChars={props.maxQuestionChars} />
              </span>
              <ComposerSubmit maxChars={props.maxQuestionChars} onStop={props.onStopAnswer} />
            </div>
            <span class="sr-only" id="librarian-source-error" aria-live="polite">
              {props.sourcesAvailable ? '' : 'Switch on at least one source.'}
            </span>
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
