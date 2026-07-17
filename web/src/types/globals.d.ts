// Ambient declarations for browser-global and bundler-provided values.

// Vite `?raw` imports used for inline SVG icons.
declare module '*.svg?raw' {
  const content: string;
  export default content;
}

// Injected at build time by vite.config.ts.
declare const __THINGY_TINYLYTICS_ID__: string;

// Build-time public config injected into the page by vite.config.ts.
interface ThingyPublicConfig {
  librarianApiUrl?: string;
  librarianStreamUrl?: string;
  tinylyticsId?: string;
  buildId?: string;
  networkLinks?: ThingyNetworkLink[];
}

interface ThingyNetworkLink {
  label?: string;
  href?: string;
  host?: string;
  key?: string;
  aliases?: string[];
}

interface Window {
  ThingyConfig?: ThingyPublicConfig;
  SpeechRecognition?: ThingySpeechRecognitionConstructor;
  webkitSpeechRecognition?: ThingySpeechRecognitionConstructor;
}

interface ThingySpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
    length: number;
  }>;
}

interface ThingySpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: ThingySpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

interface ThingySpeechRecognitionConstructor {
  new (): ThingySpeechRecognition;
}

interface HTMLElement {
  _thingyUnmount?: () => void;
}

// House convention: API helpers throw Error objects enriched with response
// metadata so callers can branch on status without a custom error class.
interface Error {
  status?: number;
  requestId?: string;
  data?: unknown;
  raw?: string;
}

interface ThingyMode {
  id: string;
  label: string;
  description?: string;
}

interface ThingyConversationSummary extends LibrarianConversationSummary {
  id: string;
  conversation_id?: string;
  preview?: string;
  local?: boolean;
  draft?: boolean;
}

interface ThingyChatState {
  conversations: ThingyConversationSummary[];
  activeConversationId: string | null;
  availableModes: ThingyMode[];
  activeMode: string;
  preferredName: string;
}

interface ThingyActivityStep {
  label: string;
  note?: string;
  kind?: string;
}

interface ThingyArchiveItem {
  url?: string;
  title?: string;
  subject?: string;
  label?: string;
  publish_date?: string;
  reason?: string;
  source_kind?: string;
}

interface ThingyExperience {
  kind?: string;
  title?: string;
  intro?: string;
  prompt?: string;
  items?: ThingyArchiveItem[];
}

interface ThingyCitation {
  issue_number?: string | number;
  url?: string;
  subject?: string;
  publish_date?: string;
  section?: string;
}

interface ThingyCuriosityNode {
  id: string;
  label: string;
  kind?: string;
  prompt?: string;
  why?: string;
  weight?: number;
}

interface ThingyCuriosityEdge {
  from: string;
  to: string;
}

interface ThingyCuriosityMap {
  title?: string;
  prompt?: string;
  nodes?: ThingyCuriosityNode[];
  edges?: ThingyCuriosityEdge[];
  sources?: ThingyArchiveItem[];
}

type AssistantMessageStatus = 'pending' | 'streaming' | 'done' | 'stopped' | 'error' | 'static';

interface AssistantMessageModel {
  id: string;
  content: import('@preact/signals').Signal<string>;
  citations: import('@preact/signals').Signal<ThingyCitation[]>;
  activity: import('@preact/signals').Signal<ThingyActivityStep[]>;
  commentary: import('@preact/signals').Signal<string[]>;
  experience: import('@preact/signals').Signal<ThingyExperience | null>;
  artifactHtml: import('@preact/signals').Signal<string>;
  status: import('@preact/signals').Signal<AssistantMessageStatus>;
  statusFallback: import('@preact/signals').Signal<string>;
  label: import('@preact/signals').Signal<string>;
  errorMessage: import('@preact/signals').Signal<string>;
  retryPrompt: import('@preact/signals').Signal<string>;
  requestId: import('@preact/signals').Signal<string>;
  startedAt: import('@preact/signals').Signal<number>;
  elapsedSeconds: import('@preact/signals').Signal<number>;
}

interface AssistantMessageOptions {
  content?: unknown;
  citations?: ThingyCitation[];
  activity?: ThingyActivityStep[];
  commentary?: string[];
  experience?: ThingyExperience | null;
  artifactHtml?: unknown;
  status?: AssistantMessageStatus;
  statusFallback?: string;
  label?: string;
  requestId?: unknown;
  startedAt?: number;
  elapsedSeconds?: number;
}

interface ThingyDispatchMessage {
  id?: string;
  baseId?: string;
  scope?: string;
  role?: 'user' | 'assistant' | 'system';
  text?: string;
  time?: string;
  kind?: string;
  status?: string;
  startedAt?: number;
  completedAt?: number | string;
}

interface ThingyDispatchDraftSummary {
  id: string;
  title: string;
  stage: string;
}

interface ThingyDispatchAction {
  id: string;
  label: string;
  kind: string;
  href?: string;
}

interface ThingyDispatchDraft {
  id: string;
  stage: string;
  prompt: string;
  direction: string;
  conversationId: string;
  currentQuestion: string;
  clarificationAnswer: string;
  brief: DispatchBrief;
  dispatchId: string;
  title: string;
  statusText: string;
  updatedAt: string;
  messages: ThingyDispatchMessage[];
}

interface ThingyTokenPayload {
  exp?: number;
}

interface ThingyRequestOptions {
  baseUrl?: string;
  path?: string;
  payload?: unknown;
  headers?: Record<string, string>;
  controller?: AbortController;
  timeoutMs?: number;
  missingMessage?: string;
  abortMessage?: string;
  defaultErrorMessage?: string;
  requestIdSource?: 'header' | 'data';
}

// Imperative UI factories accept small option bags whose concrete shape is
// narrowed inside each factory. API, session, store, and message boundaries
// use dedicated interfaces above; this escape hatch is limited to DOM glue.
// oxlint-disable-next-line typescript/no-explicit-any
type ThingyOptions = Record<string, any>;
