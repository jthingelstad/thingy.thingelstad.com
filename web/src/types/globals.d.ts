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

interface ThingyChatViewMessage {
  id: string;
  role: 'user' | 'assistant';
  prompt?: string;
  scope?: string;
  model?: AssistantMessageModel;
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
