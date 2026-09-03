// The Thingy app: one SPA serving /chat, /signin, and /c/<token> on
// TanStack Router (2026-09-03; previously three separate page entries -
// the multi-page split was a GitHub Pages artifact). The marketing pages
// (/, /about/, /connect/) stay static HTML for SEO. All three app shells
// load this module; the router owns the path.

import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Outlet,
  RouterProvider
} from '@tanstack/react-router';
import '../styles/app.css';
import { initTheme } from '../shared/thingy-theme.ts';
import { registerClientErrorTracking } from '../shared/thingy-analytics.ts';
import { composeExplorePrompt } from '../shared/thingy-explore.ts';
import { resolveFromValue } from '../shared/thingy-from.ts';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.ts';
import { bootWebMcp } from '../shared/thingy-webmcp.ts';
import * as session from '../shared/thingy-session.ts';
import { bootParams } from './boot.ts';
import { type ChatInitial } from '../react/ChatApp.tsx';
import { SignInApp } from '../react/SignInApp.tsx';

// ChatApp and ShareApp mount the full assistant-ui thread (markdown,
// shiki hooks, TanStack Query) - the heavy half of the bundle. Loading
// them lazily keeps the shared entry small, so magic-link landings on
// /signin stop downloading the whole chat runtime. SignInApp itself
// stays eager: it IS the light path.
const LazyChatApp = lazyRouteComponent(() => import('../react/ChatApp.tsx'), 'ChatApp');
const LazyShareApp = lazyRouteComponent(() => import('../react/ShareApp.tsx'), 'ShareApp');

initTheme();
registerClientErrorTracking('chat');

// URL params are read (in boot.ts and here) BEFORE loadTinylytics scrubs
// them from the address bar.
const explore = composeExplorePrompt(bootParams.get('explore'), bootParams.get('issue'));
// A seeded prompt AUTO-SENDS only when the visit came from one of the
// network's own properties (or in-site navigation) - any page on the web
// can link ?prompt=<attacker text>, and auto-submitting it would spend
// the reader's quota and plant attacker words as their own turn (audit
// W3). Everyone else still gets the composer prefilled.
const referrerHost = (() => {
  try {
    return document.referrer ? new URL(document.referrer).hostname.toLowerCase() : '';
  } catch {
    return '';
  }
})();
const promptAutoSend =
  referrerHost === window.location.hostname ||
  referrerHost === 'thingelstad.com' ||
  referrerHost.endsWith('.thingelstad.com');

const chatInitial: ChatInitial = {
  prompt: (String(bootParams.get('prompt') || '').trim() || explore.prompt).slice(0, 1200),
  promptAutoSend,
  from: resolveFromValue(bootParams.get('from') || explore.sourceUrl || null),
  // Guests never adopt a deep-linked conversation id - it would ride
  // guest requests as someone else's conversation_id.
  conversationId: session.sessionActive() ? String(bootParams.get('conversation') || '').trim() : ''
};
const loginToken = String(bootParams.get('login_token') || bootParams.get('magic_token') || '').trim();
const emailParam = session.normalizeEmail(bootParams.get('email'));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } }
});

const rootRoute = createRootRoute({
  component: () => (
    <QueryClientProvider client={queryClient}>
      <Outlet />
    </QueryClientProvider>
  )
});

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat',
  component: function ChatRoute() {
    return <LazyChatApp initial={chatInitial} />;
  }
});

const signinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signin',
  component: function SignInRoute() {
    return <SignInApp initialLoginToken={loginToken} initialEmail={emailParam} />;
  }
});

const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/c/$token',
  component: function ShareRoute() {
    const { token } = shareRoute.useParams();
    return <LazyShareApp token={token} />;
  }
});

// The share shell serves every /c/<token> path; anything else unknown
// lands on chat.
const fallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$',
  component: function FallbackRoute() {
    return <LazyChatApp initial={chatInitial} />;
  }
});

const router = createRouter({
  routeTree: rootRoute.addChildren([chatRoute, signinRoute, shareRoute, fallbackRoute]),
  trailingSlash: 'preserve'
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

if (loginToken || emailParam) {
  const path = window.location.pathname;
  if (path.startsWith('/chat')) {
    // Sign-in intents that land on /chat hand off to the sign-in route
    // WITH their credentials - signInUrl('/chat/') built a clean URL and
    // silently dropped the token/email.
    const target = new URL('/signin/', window.location.origin);
    if (loginToken) target.searchParams.set('login_token', loginToken);
    if (emailParam) target.searchParams.set('email', emailParam);
    target.searchParams.set('return', '/chat/');
    window.location.replace(target.toString());
  }
}

const host = document.getElementById('thingy-app');
if (host) createRoot(host).render(<RouterProvider router={router} />);
loadTinylytics();
void bootWebMcp();
