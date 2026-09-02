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
  // WebMCP kill switch: set to 'off' via a window.ThingyConfig override to
  // stop registering archive tools with the browser's model context.
  webmcp?: 'off' | 'on';
}

// Minimal WebMCP surface (W3C WebML CG draft): what thingy-webmcp.ts needs
// from document.modelContext / the deprecated navigator alias / the polyfill.
interface ModelContextLike {
  registerTool(
    tool: {
      name: string;
      title?: string;
      description: string;
      inputSchema: Record<string, unknown>;
      execute: (args: Record<string, unknown>) => Promise<unknown> | unknown;
    },
    options?: { signal?: AbortSignal }
  ): Promise<unknown> | unknown;
}

interface Document {
  modelContext?: ModelContextLike;
}

interface Navigator {
  modelContext?: ModelContextLike;
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
