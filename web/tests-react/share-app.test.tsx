import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ShareApp } from '../src/react/ShareApp.tsx';

const PAYLOAD = {
  conversation: { title: 'Bison across the archive', shared_at: '2026-09-01T12:00:00Z' },
  messages: [
    { role: 'user', content: 'Tell me about bison.', request_id: 'r1' },
    {
      role: 'assistant',
      content: 'Jamie wrote about bison in WT127.',
      request_id: 'r1',
      citations: [{ issue_number: 127, url: '/archive/127/', subject: 'Bison' }]
    }
  ]
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(PAYLOAD), { status: 200 }))
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('renders the shared conversation live: transcript, banner, composer', async () => {
  render(<ShareApp token="shr_testtoken" />);
  await screen.findByRole('heading', { name: 'Bison across the archive' });
  await screen.findByText('Tell me about bison.');
  const wtLink = await screen.findByRole('link', { name: 'WT127' });
  expect(wtLink.getAttribute('href')).toBe('https://weekly.thingelstad.com/archive/127/');
  expect(screen.getByLabelText('Guest preview')).toBeTruthy();
  expect(screen.getByPlaceholderText('Ask Thingy…')).toBeTruthy();
});

test('the owner sees open-the-original instead of a composer', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...PAYLOAD,
            conversation: { ...PAYLOAD.conversation, owner: true, conversation_id: 'conv-9' }
          }),
          { status: 200 }
        )
    )
  );
  render(<ShareApp token="shr_owntoken" />);
  await screen.findByText(/This is your shared conversation/);
  const original = screen.getByRole('link', { name: 'Open the original' });
  expect(original.getAttribute('href')).toBe('/chat/?conversation=conv-9');
  expect(screen.queryByPlaceholderText('Ask Thingy…')).toBeNull();
});

test('a failed share fetch shows the unavailable state', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: 404 }))
  );
  render(<ShareApp token="shr_gonetoken" />);
  await screen.findByText(/no longer available/);
});

test('an invalid token never fetches', async () => {
  render(<ShareApp token="not a token!" />);
  await screen.findByText(/no longer available/);
  expect(fetch).not.toHaveBeenCalled();
});
