// Message rendering: react-markdown (via MarkdownText.tsx) renders
// answers; assistant-ui supplies the message lifecycle around it. Styled
// with Tailwind; the librarian-* class names stay as stable hooks for
// smoke tests and the answer-typography stylesheet.

import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  useAuiState
} from '@assistant-ui/react';
import { createChatMessageActions } from '../../shared/thingy-message-actions.ts';
import { trackEvent } from '../../shared/thingy-analytics.ts';
import { Icon } from './Icon.tsx';
import { Tip } from './Tip.tsx';
import { AssistantMarkdown } from './MarkdownText.tsx';

const messageActionsService = createChatMessageActions({ track: (name, value) => trackEvent(name, value) });

const ACTION_BUTTON =
  'grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-ink [&_svg]:size-4';

// Quiet by default on pointer devices, revealed on hover/focus; the
// newest message keeps its controls visible (rule in tailwind.css).
const ACTIONS_ROW = 'thingy-message-actions mt-1 flex items-center gap-0.5';

function ActivityPart(props: { text: string }) {
  const lines = props.text.split('\n').filter(Boolean);
  if (!lines.length) return null;
  return (
    <details className="thingy-aui-activity group/act mb-2">
      <summary className="cursor-pointer list-none text-[13px] font-semibold text-muted select-none hover:text-ink [&::-webkit-details-marker]:hidden">
        <span className="mr-1 inline-block transition-transform group-open/act:rotate-90">›</span>
        Archive work{' '}
        <span className="font-normal">
          · {lines.length} step{lines.length === 1 ? '' : 's'}
        </span>
      </summary>
      <ul className="mt-1.5 ml-2 grid gap-1 border-l-2 border-line-soft pl-3 text-[13px] text-ink-soft">
        {lines.map((line, index) => (
          <li key={index}>{line}</li>
        ))}
      </ul>
    </details>
  );
}

function messageHostOf(event: React.MouseEvent<HTMLButtonElement>) {
  return (event.currentTarget as HTMLElement).closest<HTMLElement>('.librarian-message');
}

export function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="librarian-message librarian-message-assistant group w-full py-3">
      <MessagePrimitive.Parts components={{ Text: AssistantMarkdown, Reasoning: ActivityPart }} />
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className="mt-2 rounded-lg border border-error/40 bg-error/8 px-3.5 py-2.5 text-sm text-error">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
      <div className={ACTIONS_ROW}>
        <Tip label="Copy answer">
          <button
            type="button"
            className={ACTION_BUTTON}
            aria-label="Copy answer"
            onClick={(event) => {
              const host = messageHostOf(event);
              if (host) void messageActionsService.copyAnswerRichText(host);
            }}
          >
            <Icon name="copy" />
          </button>
        </Tip>
        <Tip label="Share answer">
          <button
            type="button"
            className={ACTION_BUTTON}
            aria-label="Share answer"
            data-rw-action=""
            onClick={(event) => {
              const host = messageHostOf(event);
              if (host) void messageActionsService.shareAnswer(host);
            }}
          >
            <Icon name="share" />
          </button>
        </Tip>
        <ActionBarPrimitive.Root hideWhenRunning autohide="never" className="flex items-center gap-0.5">
          <Tip label="Good response">
            <ActionBarPrimitive.FeedbackPositive asChild>
              <button
                type="button"
                className={`${ACTION_BUTTON} data-submitted:text-accent-deep`}
                aria-label="Good response"
                data-rw-action=""
              >
                <Icon name="thumbs-up" />
              </button>
            </ActionBarPrimitive.FeedbackPositive>
          </Tip>
          <Tip label="Bad response">
            <ActionBarPrimitive.FeedbackNegative asChild>
              <button
                type="button"
                className={`${ACTION_BUTTON} data-submitted:text-error`}
                aria-label="Bad response"
                data-rw-action=""
              >
                <Icon name="thumbs-down" />
              </button>
            </ActionBarPrimitive.FeedbackNegative>
          </Tip>
          <Tip label="Regenerate answer">
            <ActionBarPrimitive.Reload asChild>
              <button type="button" className={ACTION_BUTTON} aria-label="Regenerate answer" data-rw-action="">
                <Icon name="rotate-ccw" />
              </button>
            </ActionBarPrimitive.Reload>
          </Tip>
        </ActionBarPrimitive.Root>
        <BranchPickerFooter />
      </div>
    </MessagePrimitive.Root>
  );
}

function BranchPickerFooter() {
  return (
    <BranchPickerPrimitive.Root hideWhenSingleBranch className="ml-1 flex items-center gap-0.5 text-xs text-muted">
      <Tip label="Previous version">
        <BranchPickerPrimitive.Previous asChild>
          <button type="button" className={ACTION_BUTTON} aria-label="Previous version">
            <Icon name="chevron-left" />
          </button>
        </BranchPickerPrimitive.Previous>
      </Tip>
      <span className="font-mono tabular-nums">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <Tip label="Next version">
        <BranchPickerPrimitive.Next asChild>
          <button type="button" className={ACTION_BUTTON} aria-label="Next version">
            <Icon name="chevron-right" />
          </button>
        </BranchPickerPrimitive.Next>
      </Tip>
    </BranchPickerPrimitive.Root>
  );
}

export function UserMessage() {
  const promptText = useAuiState((state) =>
    state.message.content.map((part) => ('text' in part ? String(part.text || '') : '')).join('')
  );
  return (
    <MessagePrimitive.Root className="librarian-message librarian-message-user group flex w-full flex-col items-end py-3">
      <div className="max-w-[78%] rounded-3xl rounded-br-lg bg-ink px-4.5 py-2.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap text-bg">
        <MessagePrimitive.Parts />
      </div>
      <div className={`${ACTIONS_ROW} justify-end`}>
        <Tip label="Copy prompt">
          <button
            type="button"
            className={ACTION_BUTTON}
            aria-label="Copy prompt"
            onClick={() => void messageActionsService.copyPrompt(promptText)}
          >
            <Icon name="copy" />
          </button>
        </Tip>
        <Tip label="Share prompt">
          <button
            type="button"
            className={ACTION_BUTTON}
            aria-label="Share prompt"
            data-rw-action=""
            onClick={() => void messageActionsService.sharePrompt(promptText)}
          >
            <Icon name="share" />
          </button>
        </Tip>
        <ActionBarPrimitive.Root hideWhenRunning autohide="never" className="flex items-center gap-0.5">
          <Tip label="Edit and resend">
            <ActionBarPrimitive.Edit asChild>
              <button type="button" className={ACTION_BUTTON} aria-label="Edit message" data-rw-action="">
                <Icon name="pencil" />
              </button>
            </ActionBarPrimitive.Edit>
          </Tip>
        </ActionBarPrimitive.Root>
        <BranchPickerFooter />
      </div>
    </MessagePrimitive.Root>
  );
}

export function EditComposer() {
  return (
    <ComposerPrimitive.Root className="my-3 w-full rounded-2xl border border-accent/50 bg-surface p-3 shadow-sm">
      <ComposerPrimitive.Input className="max-h-[40dvh] w-full resize-none bg-transparent font-sans text-[15px] text-ink outline-none" />
      <div className="mt-2 flex justify-end gap-2">
        <ComposerPrimitive.Cancel asChild>
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-1.5 text-sm font-bold text-ink hover:bg-surface-2"
          >
            Cancel
          </button>
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild>
          <button
            type="button"
            className="rounded-lg bg-accent-deep px-3 py-1.5 text-sm font-bold text-bg hover:brightness-110"
          >
            Send
          </button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}
