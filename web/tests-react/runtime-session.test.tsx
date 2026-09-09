import { expect, test, vi } from 'vitest';

const requireSession = vi.fn();
const postJsonStream = vi.fn();
const clearAuth = vi.fn();
vi.mock('../src/shared/thingy-session.ts', () => ({
  requireSession,
  authHeaders: () => ({}),
  clearAuth,
  signInUrl: () => '/signin/'
}));
vi.mock('../src/shared/thingy-stream.ts', () => ({ postJsonStream, read: vi.fn() }));
const { createThingyAdapter } = await import('../src/react/thingy-runtime.ts');

test('a rejected reader session never sends a message into the guest lane', async () => {
  requireSession.mockRejectedValueOnce(Object.assign(new Error('Sign in again'), { status: 401 }));
  const adapter = createThingyAdapter({ conversationId: '', guest: false });
  const run = adapter.run({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'My next question' }] }],
    abortSignal: new AbortController().signal
  } as never) as AsyncGenerator;
  await expect(run.next()).rejects.toMatchObject({ status: 401 });
  expect(postJsonStream).not.toHaveBeenCalled();
  expect(clearAuth).toHaveBeenCalledOnce();
});
