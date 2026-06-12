// Ambient declarations for browser-global and bundler-provided values.

// Vite `?raw` imports used for inline SVG icons.
declare module '*.svg?raw' {
  const content: string;
  export default content;
}

// Injected at build time by vite.config.js.
declare const __THINGY_TINYLYTICS_ID__: string;

// Build-time public config injected into the page by vite.config.js.
interface ThingyPublicConfig {
  librarianApiUrl?: string;
  librarianStreamUrl?: string;
  tinylyticsId?: string;
  buildId?: string;
  networkLinks?: Array<{ label?: string; href?: string; host?: string }>;
}

interface Window {
  ThingyConfig?: ThingyPublicConfig;
}

// House convention: API helpers throw Error objects enriched with response
// metadata so callers can branch on status without a custom error class.
interface Error {
  status?: number;
  requestId?: string;
  data?: any;
  raw?: string;
}
