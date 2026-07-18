import { type JSX, type RefObject } from 'preact';
import { dispatchInputPlaceholder, dispatchText } from '../stores/dispatch-store.ts';
import { ComposerCount } from './ComposerCount.tsx';
import { DispatchActions } from './DispatchActions.tsx';
import { DispatchMessages } from './DispatchMessages.tsx';
import { DispatchStatus } from './DispatchStatus.tsx';
import { ThingyIcon } from './ThingyIcon.tsx';

interface DispatchConversationViewProps {
  scrollRef: RefObject<HTMLDivElement>;
  inputRef: RefObject<HTMLTextAreaElement>;
  title: string;
  mobileOpen: boolean;
  ready: boolean;
  text: string;
  inputDisabled: boolean;
  editable: boolean;
  submitDisabled: boolean;
  maxInputChars: number;
  track: (name: string, value?: string) => void;
  onToggleMobileRail: () => void;
  onNewDispatch: () => void;
  onAction: (actionId: string) => void;
  onSubmit: (event: JSX.TargetedSubmitEvent<HTMLFormElement>) => void;
  onTextInput: (value: string) => void;
}

function DispatchConversationView(props: DispatchConversationViewProps) {
  return (
    <section class="thingy-conversation dispatch-conversation" aria-label="Thingy Dispatch">
      <h1 class="sr-only">Thingy Dispatch</h1>
      <div class="mobile-chatbar" aria-label="Dispatch">
        <button
          class="mobile-chatbar-circle"
          type="button"
          aria-label={props.mobileOpen ? 'Hide Dispatches' : 'Show Dispatches'}
          aria-expanded={props.mobileOpen}
          title={props.mobileOpen ? 'Hide Dispatches' : 'Show Dispatches'}
          onClick={props.onToggleMobileRail}
        >
          <ThingyIcon name="chevron-left" />
        </button>
        <div class="mobile-chatbar-title">
          <span>{props.title}</span>
        </div>
        <div class="mobile-chatbar-actions">
          <button
            class="mobile-chatbar-action"
            type="button"
            aria-label="New Dispatch"
            title="New Dispatch"
            onClick={props.onNewDispatch}
          >
            <ThingyIcon name="plus" />
          </button>
        </div>
      </div>
      <div class="dispatch-chat" id="dispatch-app" hidden={!props.ready}>
        <div ref={props.scrollRef} class="thingy-chat-scroll dispatch-scroll">
          <div class="librarian-messages dispatch-messages" aria-live="polite">
            <DispatchMessages scrollContainer={() => props.scrollRef.current} track={props.track} />
          </div>
        </div>
        <div class="thingy-composer-zone dispatch-composer-zone">
          <DispatchActions onAction={props.onAction} />
          <form
            class="librarian-form librarian-question-form thingy-input composer-box dispatch-composer"
            onSubmit={props.onSubmit}
          >
            <label for="dispatch-input" class="sr-only">
              Message Thingy about this Dispatch
            </label>
            <textarea
              ref={props.inputRef}
              id="dispatch-input"
              rows={1}
              maxLength={props.maxInputChars}
              required
              value={props.text}
              disabled={props.inputDisabled}
              placeholder={dispatchInputPlaceholder.value}
              onInput={(event) => props.onTextInput(event.currentTarget.value)}
            />
            <div class="composer-toolbar">
              <DispatchStatus />
              <span class="composer-spacer" />
              <ComposerCount maxChars={props.maxInputChars} text={dispatchText} />
              <button
                type="submit"
                class="composer-send"
                disabled={props.submitDisabled}
                aria-label="Send to Thingy"
                title={props.editable ? 'Send to Thingy' : 'Start a new Dispatch to continue'}
                data-tinylytics-event="dispatch.message"
              >
                <ThingyIcon name="arrow-up" />
              </button>
            </div>
          </form>
          <p class="thingy-ai-note">
            Dispatches are written by Thingy from Jamie&rsquo;s public archive, then sent by email when you generate
            them.
          </p>
        </div>
      </div>
    </section>
  );
}

export { DispatchConversationView };
