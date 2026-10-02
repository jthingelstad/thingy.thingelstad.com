// Message rendering: react-markdown (via MarkdownText.tsx) renders
// answers; assistant-ui supplies the message lifecycle around it. Styled
// with Tailwind; the librarian-* class names stay as stable hooks for
// smoke tests and the answer-typography stylesheet.

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  ActionBarPrimitive,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  useAuiState
} from '@assistant-ui/react';
import { createChatMessageActions } from '../../shared/thingy-message-actions.ts';
import { liveActivityStatus } from '../thingy-runtime.ts';
import { trackEvent } from '../../shared/thingy-analytics.ts';
import { Icon } from './Icon.tsx';
import { ThingyFace } from './ThingyFace.tsx';
import { Tip } from './Tip.tsx';
import { AssistantMarkdown } from './MarkdownText.tsx';
import { citationKind, thingyUrlTransform, type CitationKind } from './markdown-config.ts';

const messageActionsService = createChatMessageActions({ track: (name, value) => trackEvent(name, value) });

const ACTION_BUTTON =
  'grid size-11 place-items-center rounded-xl text-quiet transition-colors hover:bg-toy hover:text-ink [&_svg]:size-[18px]';

// Quiet by default on pointer devices, revealed on hover/focus; the
// newest message keeps its controls visible (rule in tailwind.css).
const ACTIONS_ROW = 'thingy-message-actions mt-1 flex flex-wrap items-center gap-0.5';

function formatElapsed(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

// Claude-style response receipt: a live elapsed readout while the answer
// streams, frozen once it completes. Only turns observed running get one -
// reloaded history has no start moment to measure from.
function formatTokens(count: number) {
  if (count >= 10_000) return `${Math.round(count / 1000)}k tokens`;
  if (count >= 1_000) return `${(count / 1000).toFixed(1)}k tokens`;
  return `${count} tokens`;
}

function ResponseTimer() {
  const running = useAuiState((state) => state.message.status?.type === 'running');
  const messageId = useAuiState((state) => state.message.id);
  const receipt = useAuiState(
    (state) =>
      (state.message.metadata?.custom as { receipt?: { duration_ms?: number; total_tokens?: number } } | undefined)
        ?.receipt
  );
  const phrase = useSyncExternalStore(liveActivityStatus.subscribe, liveActivityStatus.get);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);
  const sawRunRef = useRef(false);
  const idRef = useRef(messageId);
  // assistant-ui renders message slots keyed by INDEX, so this component
  // instance serves whichever message occupies the slot - branch switches
  // and regenerations arrive as id/run changes, not remounts.
  if (idRef.current !== messageId) {
    idRef.current = messageId;
    startRef.current = 0;
    sawRunRef.current = false;
  }
  useEffect(() => {
    if (!running) {
      if (startRef.current) setElapsed(Date.now() - startRef.current);
      return;
    }
    sawRunRef.current = true;
    // Each run measures from ITS OWN start - a regenerate must not show
    // cumulative time since the original generation.
    startRef.current = Date.now();
    setElapsed(0);
    const tick = window.setInterval(() => setElapsed(Date.now() - startRef.current), 1000);
    return () => window.clearInterval(tick);
  }, [running]);
  // The server's measured duration (4.8 receipt) beats the client's
  // approximation, and lets reloaded history and share transcripts show
  // a receipt without ever having run in this session.
  const hasText = useAuiState((state) =>
    state.message.content.some((part) => part.type === 'text' && String(part.text || '').trim())
  );
  const serverMs = Number(receipt?.duration_ms || 0);
  const tokens = Number(receipt?.total_tokens || 0);
  if (!sawRunRef.current && !serverMs) return null;
  const shownMs = !running && serverMs ? serverMs : elapsed;
  return (
    <span className="thingy-response-timer inline-flex min-w-0 items-center gap-1.5 font-mono text-[12px] text-quiet tabular-nums">
      {formatElapsed(shownMs)}
      {!running && tokens ? <span className="shrink-0">· {formatTokens(tokens)}</span> : null}
      {/* Before the first words the thinking card carries the phrase. */}
      {running && hasText && phrase ? <span className="truncate font-sans">· {phrase}</span> : null}
    </span>
  );
}

// The face beside each answer: scanning while Thingy works, a wink once
// an answer has landed, the oops face when the turn failed. Only the
// working face moves.
function MessageFace({ size }: { size: number }) {
  const status = useAuiState((state) => state.message.status);
  const hasText = useAuiState((state) =>
    state.message.content.some((part) => part.type === 'text' && String(part.text || '').trim())
  );
  const running = status?.type === 'running';
  const failed = status?.type === 'incomplete' && status.reason === 'error';
  const mood = running ? 'thinking' : failed ? 'oops' : hasText ? 'found-it' : 'idle';
  return <ThingyFace mood={mood} size={size} animated={running} className="thingy-message-face" />;
}

function stripEllipsis(phrase: string) {
  return phrase.replace(/\s*(\.\.\.|…)\s*$/, '');
}

// The thinking state before the first words arrive: the screen card
// with the live phrase from the stream ("Thinking...", the tool status
// lines), three blinking dots, and the archive steps so far - earlier
// steps ticked, the current one pointed at. Only real stream text.
function ThinkingCard() {
  const running = useAuiState((state) => state.message.status?.type === 'running');
  const hasText = useAuiState((state) =>
    state.message.content.some((part) => part.type === 'text' && String(part.text || '').trim())
  );
  const steps = useAuiState((state) =>
    state.message.content
      .filter((part) => part.type === 'reasoning')
      .map((part) => String((part as { text?: string }).text || ''))
      .join('\n')
  );
  const phrase = useSyncExternalStore(liveActivityStatus.subscribe, liveActivityStatus.get);
  if (!running || hasText) return null;
  const lines = steps.split('\n').filter(Boolean);
  return (
    <div className="thingy-thinking mb-2 inline-flex max-w-full flex-col gap-1.5 rounded-[22px] border-4 border-bezel bg-screen px-[22px] py-4 text-mint shadow-[0_0_0_2px_var(--thingy-ink),0_6px_0_2px_var(--thingy-ink)]">
      <span className="thingy-display flex items-center gap-3 text-[18px] text-bg md:text-[19px]">
        <span className="min-w-0">{stripEllipsis(phrase || 'Thinking...')}</span>
        <span className="thingy-dots inline-flex shrink-0 gap-[5px]" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </span>
      {lines.length ? (
        <ul className="grid gap-[3px] font-mono text-[12.5px] leading-snug">
          {lines.map((line, index) => {
            const current = index === lines.length - 1;
            const failed = line.startsWith('✗');
            return (
              <li key={index} className={current && !failed ? 'text-[#f2c49e]' : failed ? 'text-oops' : undefined}>
                {failed ? line : `${current ? '›' : '✓'} ${line}`}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function ActivityPart(props: { text: string }) {
  const running = useAuiState((state) => state.message.status?.type === 'running');
  const hasText = useAuiState((state) =>
    state.message.content.some((part) => part.type === 'text' && String(part.text || '').trim())
  );
  const lines = props.text.split('\n').filter(Boolean);
  // The thinking card shows the steps live; the fold takes over once
  // the answer starts.
  if (!lines.length || (running && !hasText)) return null;
  return (
    <details className="thingy-aui-activity group/act mb-2">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 rounded-xl pr-2 font-mono text-[12px] font-semibold tracking-[0.04em] text-meta select-none hover:text-ink [&::-webkit-details-marker]:hidden">
        <span className="inline-block transition-transform group-open/act:rotate-90">›</span>
        Archive work{' '}
        <span className="font-normal">
          · {lines.length} step{lines.length === 1 ? '' : 's'}
        </span>
      </summary>
      <ul className="mt-1 ml-1 grid gap-1 border-l-2 border-dashed border-rule pl-3 font-mono text-[12.5px] text-quiet">
        {lines.map((line, index) => (
          // Failed steps arrive prefixed with ✗ from the stream - show them
          // in the error tone so the row reads like a failed command.
          <li key={index} className={line.startsWith('✗') ? 'text-danger' : undefined}>
            {line}
          </li>
        ))}
      </ul>
    </details>
  );
}

// Cited sources as cards under the answer. The inline WT-token
// autolinks only surface citations the prose happens to mention by
// number - blog/podcast sources and unmentioned issues were silently
// dropped, and hover titles don't exist on touch. The metadata rides
// every message, including reloaded history and share transcripts.
// Each card wears its source's colour band: Weekly cobalt with the W
// disc, blog toy cream with the host, Another Thing slate with its dots.
// A grid on wide screens, a stack of horizontal cards on a phone.
function sourceMonth(value: string) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return '';
  return new Date(time).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function sourceHost(href: string) {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const BAND: Record<CitationKind, string> = {
  weekly: 'thingy-source-band-weekly bg-weekly text-white',
  blog: 'bg-toy text-[#8a3410]',
  podcast: 'bg-another text-white'
};

const BADGE: Record<CitationKind, string> = {
  weekly: 'text-weekly-deep',
  blog: 'text-clay',
  podcast: 'text-another'
};

function SourceMark({ kind }: { kind: CitationKind }) {
  if (kind === 'weekly') return <span className="thingy-w-disc" aria-hidden="true" />;
  if (kind === 'podcast') return <span className="thingy-another-dots" aria-hidden="true" />;
  return null;
}

function SourcesFooter() {
  const metadata = useAuiState((state) => state.message.metadata);
  const citations = ((metadata?.custom as { citations?: ThingyCitation[] } | undefined)?.citations || []).filter(
    (citation) => citation && (citation.url || citation.issue_number)
  );
  if (!citations.length) return null;
  return (
    <nav
      className="librarian-sources mt-4 grid gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(200px,1fr))] sm:gap-3"
      aria-label="Sources"
    >
      {citations.slice(0, 8).map((citation, index) => {
        const issue = String(citation.issue_number || '').trim();
        const kind = citationKind(citation);
        const badge = issue ? `WT${issue}` : kind === 'blog' ? 'Blog' : kind === 'podcast' ? 'Podcast' : 'Source';
        const href = thingyUrlTransform(String(citation.url || (issue ? `/archive/${issue}/` : '')));
        const date = sourceMonth(String(citation.publish_date || ''));
        const label = String(citation.subject || '').trim();
        const host = sourceHost(href);
        const bandLabel = kind === 'weekly' ? 'Weekly Thing' : kind === 'podcast' ? 'Another Thing' : host || 'Blog';
        const footer = String(citation.section || '').trim() || (kind === 'blog' ? host : '');
        const card = (
          <>
            <span
              className={`relative flex shrink-0 items-center gap-2 border-ink max-sm:w-14 max-sm:justify-center max-sm:border-r-2 sm:h-10 sm:px-3 ${
                kind === 'blog' ? 'sm:border-b-2' : ''
              } font-mono text-[11px] font-semibold tracking-[0.14em] uppercase ${BAND[kind]}`}
            >
              <SourceMark kind={kind} />
              {kind === 'blog' ? (
                <svg
                  className="size-[22px] sm:hidden"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M6 3h9l4 4v14H6z" />
                  <path d="M9 11h7" />
                  <path d="M9 15h7" />
                </svg>
              ) : null}
              <span className="truncate max-sm:sr-only">{bandLabel}</span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2.5 sm:gap-1.5 sm:px-3.5 sm:py-3">
              <span className="flex justify-between gap-2 font-mono text-[11.5px] font-semibold">
                <span className={BADGE[kind]}>{badge}</span>
                {date ? <span className="text-quiet tabular-nums">{date}</span> : null}
              </span>
              {label ? <span className="line-clamp-2 text-[15px] leading-snug font-bold text-ink">{label}</span> : null}
              {footer ? (
                <span className="truncate border-t border-[#e2d4b5] pt-1.5 font-mono text-[11px] text-quiet max-sm:hidden">
                  {footer}
                </span>
              ) : null}
            </span>
          </>
        );
        const className =
          'thingy-source-card flex min-h-16 overflow-hidden rounded-[14px] border-2 border-ink bg-paper text-ink no-underline shadow-[0_3px_0_var(--thingy-ink)] sm:flex-col';
        return href ? (
          <a
            key={`${badge}-${index}`}
            className={`${className} thingy-source-card-link`}
            href={href}
            target="_blank"
            rel="noopener"
            title={label || badge}
            data-tinylytics-event="librarian.source_click"
            data-tinylytics-event-value={badge}
          >
            {card}
          </a>
        ) : (
          <span key={`${badge}-${index}`} className={className}>
            {card}
          </span>
        );
      })}
    </nav>
  );
}

function messageHostOf(event: React.MouseEvent<HTMLButtonElement>) {
  return (event.currentTarget as HTMLElement).closest<HTMLElement>('.librarian-message');
}

export function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="librarian-message librarian-message-assistant group flex w-full gap-4 pt-2 pb-3">
      <span className="hidden shrink-0 pt-0.5 md:block">
        <MessageFace size={46} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-2.5 flex min-h-8 items-center gap-2.5 md:gap-3">
          <span className="md:hidden">
            <MessageFace size={40} />
          </span>
          <span className="shrink-0 text-[15px] font-extrabold md:text-base">Thingy</span>
          <ResponseTimer />
        </div>
        <ThinkingCard />
        <MessagePrimitive.Parts components={{ Text: AssistantMarkdown, Reasoning: ActivityPart }} />
        <SourcesFooter />
        <MessagePrimitive.Error>
          <ErrorPrimitive.Root className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-danger bg-danger-tint px-4 py-3 text-[15px] text-danger">
            <ErrorPrimitive.Message />
            <ActionBarPrimitive.Reload asChild>
              <button
                type="button"
                className="thingy-error-retry thingy-btn thingy-btn-secondary thingy-btn-compact"
                data-rw-action=""
              >
                Try again
              </button>
            </ActionBarPrimitive.Reload>
          </ErrorPrimitive.Root>
        </MessagePrimitive.Error>
        <div className={`${ACTIONS_ROW} -ml-2.5`}>
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
      </div>
    </MessagePrimitive.Root>
  );
}

function BranchPickerFooter() {
  return (
    <BranchPickerPrimitive.Root hideWhenSingleBranch className="ml-1 flex items-center gap-0.5 text-xs text-quiet">
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
    <MessagePrimitive.Root className="librarian-message librarian-message-user group flex w-full flex-col items-end pt-3">
      <div className="max-w-[84%] rounded-[20px_20px_6px_20px] bg-ink px-4 py-3 text-[16px] leading-[1.45] break-words whitespace-pre-wrap text-bg md:max-w-[70%] md:rounded-[22px_22px_6px_22px] md:px-5 md:py-3.5 md:text-[17px] md:leading-normal">
        <MessagePrimitive.Parts />
      </div>
      <div className={`${ACTIONS_ROW} -mr-2.5 justify-end`}>
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
    <ComposerPrimitive.Root className="my-3 w-full rounded-[22px] border-2 border-ink bg-paper p-3.5 shadow-[0_4px_0_var(--thingy-ink)] focus-within:outline-3 focus-within:outline-offset-2 focus-within:outline-(--thingy-focus)">
      <ComposerPrimitive.Input
        aria-label="Edit message"
        className="max-h-[40dvh] w-full resize-none bg-transparent px-1 font-sans text-base text-ink outline-none md:text-[17px]"
      />
      <div className="mt-3 flex justify-end gap-2.5">
        <ComposerPrimitive.Cancel asChild>
          <button type="button" className="thingy-btn thingy-btn-secondary thingy-btn-compact">
            Cancel
          </button>
        </ComposerPrimitive.Cancel>
        <ComposerPrimitive.Send asChild>
          <button type="button" className="thingy-btn thingy-btn-primary thingy-btn-compact">
            Send
          </button>
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
}
