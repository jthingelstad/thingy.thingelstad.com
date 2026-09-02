// The Thingy app: one SPA serving /chat, /signin, and /c/<token> on
// TanStack Router (2026-09-03; previously three separate page entries -
// the multi-page split was a GitHub Pages artifact). The marketing pages
// (/, /about/, /connect/) stay static HTML for SEO. All three app shells
// load this module; the router owns the path.

import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import '../styles/app.css';
import { initTheme } from '../shared/thingy-theme.ts';
import { registerClientErrorTracking } from '../shared/thingy-analytics.ts';
import { composeExplorePrompt } from '../shared/thingy-explore.ts';
import { resolveFromValue } from '../shared/thingy-from.ts';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.ts';
import { bootWebMcp } from '../shared/thingy-webmcp.ts';
import * as session from '../shared/thingy-session.ts';
import { bootParams } from './boot.ts';
import { ChatApp, type ChatInitial } from '../react/ChatApp.tsx';
import { SignInApp } from '../react/SignInApp.tsx';
import { ShareApp } from '../react/ShareApp.tsx';

initTheme();
registerClientErrorTracking('chat');

// URL params are read (in boot.ts and here) BEFORE loadTinylytics scrubs
// them from the address bar.
const explore = composeExplorePrompt(bootParams.get('explore'), bootParams.get('issue'));
const chatInitial: ChatInitial = {
  prompt: (String(bootParams.get('prompt') || '').trim() || explore.prompt).slice(0, 1200),
  from: resolveFromValue(bootParams.get('from') || explore.sourceUrl || null)
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
    return <ChatApp initial={chatInitial} />;
  }
});

const signinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/signin',
  component: function SignInRoute() {
    return <SignInApp initialLoginToken={loginToken} />;
  }
});

const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/c/$token',
  component: function ShareRoute() {
    const { token } = shareRoute.useParams();
    return <ShareApp token={token} />;
  }
});

// The share shell serves every /c/<token> path; anything else unknown
// lands on chat.
const fallbackRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$',
  component: function FallbackRoute() {
    return <ChatApp initial={chatInitial} />;
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
    // Sign-in intents that land on /chat keep their existing flow.
    window.location.href = session.signInUrl('/chat/');
  }
}

const host = document.getElementById('thingy-app');
if (host) createRoot(host).render(<RouterProvider router={router} />);
loadTinylytics();
void bootWebMcp();
