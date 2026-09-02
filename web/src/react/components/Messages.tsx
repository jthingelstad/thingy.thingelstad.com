// Message rendering: react-markdown (via MarkdownText.tsx) renders
// answers; assistant-ui supplies the message lifecycle around it.

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
import { AssistantMarkdown } from './MarkdownText.tsx';

const messageActionsService = createChatMessageActions({ track: (name, value) => trackEvent(name, value) });

function ActivityPart(props: { text: string }) {
  const lines = props.text.split('\n').filter(Boolean);
  if (!lines.length) return null;
  return (
    <details className="librarian-activity thingy-aui-activity">
      <summary>
        Archive work{' '}
        <span className="thingy-aui-activity-count">
          {lines.length} step{lines.length === 1 ? '' : 's'}
        </span>
      </summary>
      <ul>
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
    <MessagePrimitive.Root className="librarian-message librarian-message-assistant">
      <MessagePrimitive.Parts components={{ Text: AssistantMarkdown, Reasoning: ActivityPart }} />
      <MessagePrimitive.Error>
        <ErrorPrimitive.Root className="thingy-aui-error">
          <ErrorPrimitive.Message />
        </ErrorPrimitive.Root>
      </MessagePrimitive.Error>
      <div className="librarian-feedback">
        <button
          type="button"
          aria-label="Copy answer"
          title="Copy answer"
          onClick={(event) => {
            const host = messageHostOf(event);
            if (host) void messageActionsService.copyAnswerRichText(host);
          }}
        >
          <Icon name="copy" />
        </button>
        <button
          type="button"
          aria-label="Share answer"
          title="Share answer"
          onClick={(event) => {
            const host = messageHostOf(event);
            if (host) void messageActionsService.shareAnswer(host);
          }}
        >
          <Icon name="share" />
        </button>
        <ActionBarPrimitive.Root hideWhenRunning autohide="never" className="thingy-aui-actionbar">
          <ActionBarPrimitive.FeedbackPositive asChild>
            <button type="button" aria-label="Good response" title="Good response">
              <Icon name="thumbs-up" />
            </button>
          </ActionBarPrimitive.FeedbackPositive>
          <ActionBarPrimitive.FeedbackNegative asChild>
            <button type="button" aria-label="Bad response" title="Bad response">
              <Icon name="thumbs-down" />
            </button>
          </ActionBarPrimitive.FeedbackNegative>
          <ActionBarPrimitive.Reload asChild>
            <button type="button" aria-label="Regenerate answer" title="Regenerate answer">
              <Icon name="rotate-ccw" />
            </button>
          </ActionBarPrimitive.Reload>
        </ActionBarPrimitive.Root>
        <BranchPickerFooter />
      </div>
    </MessagePrimitive.Root>
  );
}

function BranchPickerFooter() {
  return (
    <BranchPickerPrimitive.Root hideWhenSingleBranch className="thingy-aui-branchpicker">
      <BranchPickerPrimitive.Previous asChild>
        <button type="button" aria-label="Previous version" title="Previous version">
          <Icon name="chevron-left" />
        </button>
      </BranchPickerPrimitive.Previous>
      <span className="thingy-aui-branch-count">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <button type="button" aria-label="Next version" title="Next version">
          <Icon name="chevron-right" />
        </button>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
}

export function UserMessage() {
  const promptText = useAuiState((state) =>
    state.message.content.map((part) => ('text' in part ? String(part.text || '') : '')).join('')
  );
  return (
    <MessagePrimitive.Root className="librarian-message librarian-message-user">
      <MessagePrimitive.Parts />
      <div className="librarian-prompt-actions thingy-aui-user-actions">
        <button
          type="button"
          aria-label="Copy prompt"
          title="Copy prompt"
          onClick={() => void messageActionsService.copyPrompt(promptText)}
        >
          <Icon name="copy" />
        </button>
        <button
          type="button"
          aria-label="Share prompt"
          title="Share prompt"
          onClick={() => void messageActionsService.sharePrompt(promptText)}
        >
          <Icon name="share" />
        </button>
        <ActionBarPrimitive.Root hideWhenRunning autohide="never" className="thingy-aui-actionbar">
          <ActionBarPrimitive.Edit asChild>
            <button type="button" aria-label="Edit message" title="Edit and resend">
              <Icon name="pencil" />
            </button>
          </ActionBarPrimitive.Edit>
        </ActionBarPrimitive.Root>
        <BranchPickerFooter />
      </div>
    </MessagePrimitive.Root>
  );
}

export function EditComposer() {
  return (
    <ComposerPrimitive.Root className="thingy-aui-edit-composer">
      <ComposerPrimitive.Input className="thingy-aui-edit-input" />
      <div className="thingy-aui-edit-actions">
        <ComposerPrimitive.Cancel asChild>
          <button type="button">Cancel</button>
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild>
          <button type="button" className="primary">
            Send
          </button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}
