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
      citations: [{ issue_number: 127, url: '/archive/127/', subject: 'Bison' }],
      duration_ms: 61000,
      total_tokens: 48000
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
  expect(wtLink.getAttribute('href')).toBe('https://weekly.thingelstad.com/archive/127/?ref=thingy-source');
  expect(screen.getByLabelText('Guest preview')).toBeTruthy();
  expect(screen.getByPlaceholderText('Ask Thingy…')).toBeTruthy();
  // The 4.8 stored receipt renders without the turn ever running here.
  await screen.findByText(/1m 1s/);
  expect(screen.getByText(/48k tokens/)).toBeTruthy();
});

test('source cards name Things I have built and carry ?ref=thingy-source', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...PAYLOAD,
            messages: [
              PAYLOAD.messages[0],
              {
                ...PAYLOAD.messages[1],
                content: 'Jamie built Thingy and wrote about espresso.',
                citations: [
                  {
                    source_kind: 'thing',
                    id: 'thing-thingy',
                    url: 'https://thingelstad.xyz/things/thingy/',
                    subject: 'Thingy'
                  },
                  {
                    source_kind: 'blog',
                    url: 'https://www.thingelstad.com/2024/03/02/espresso.html#top',
                    subject: 'Espresso'
                  },
                  { source_kind: 'web', url: 'https://example.com/elsewhere/', subject: 'Elsewhere' }
                ]
              }
            ]
          }),
          { status: 200 }
        )
    )
  );
  render(<ShareApp token="shr_thingtoken" />);
  const sources = await screen.findByRole('navigation', { name: 'Sources' });
  const cards = [...sources.querySelectorAll('a.thingy-source-card')];
  expect(cards.map((card) => card.getAttribute('href'))).toEqual([
    'https://thingelstad.xyz/things/thingy/?ref=thingy-source',
    'https://www.thingelstad.com/2024/03/02/espresso.html?ref=thingy-source#top',
    'https://example.com/elsewhere/'
  ]);
  expect(cards[0].textContent).toContain('Things I’ve built');
  expect(cards[0].textContent).toContain('Project');
  expect(cards[0].getAttribute('data-tinylytics-event-value')).toBe('Project');
  expect(cards[0].querySelector('.thingy-thing-mark')).toBeTruthy();
});

test('a saved link card names Linking Things, not the blog', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ...PAYLOAD,
            messages: [
              PAYLOAD.messages[0],
              {
                ...PAYLOAD.messages[1],
                content: 'Jamie saved a Facebook how-to.',
                citations: [
                  {
                    source_kind: 'link',
                    id: 'link-a247e5eef435',
                    url: 'https://links.thingelstad.xyz/links/a247e5eef435/',
                    subject: 'How to delete your Facebook account',
                    publish_date: '2026-10-23',
                    section: 'Saved link'
                  }
                ]
              }
            ]
          }),
          { status: 200 }
        )
    )
  );
  render(<ShareApp token="shr_linktoken" />);
  const sources = await screen.findByRole('navigation', { name: 'Sources' });
  const card = sources.querySelector('a.thingy-source-card');
  expect(card?.getAttribute('href')).toBe('https://links.thingelstad.xyz/links/a247e5eef435/?ref=thingy-source');
  expect(card?.textContent).toContain('Linking Things');
  expect(card?.textContent).not.toContain('Blog');
  expect(card?.textContent).not.toContain('links.thingelstad.xyz');
  expect(card?.getAttribute('data-tinylytics-event-value')).toBe('Saved link');
  // The badge says "Saved link" once; the section repeating it is dropped.
  expect(card?.textContent?.match(/Saved link/g)?.length).toBe(1);
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
  await screen.findByText(/has been closed up/);
});

test('an invalid token never fetches', async () => {
  render(<ShareApp token="not a token!" />);
  await screen.findByText(/has been closed up/);
  expect(fetch).not.toHaveBeenCalled();
});

test('a signed-in fork shows the saved-to-your-chats banner', async () => {
  vi.resetModules();
  vi.doMock('../src/shared/thingy-session.ts', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../src/shared/thingy-session.ts')>();
    return { ...actual, sessionActive: () => true };
  });
  vi.doMock('../src/react/components/Thread.tsx', () => ({
    // Lightweight stand-in: the real ThreadHost mounts the aui runtime;
    // here we only need the fork callback the adapter would fire when
    // the server mints the reader's new conversation, plus the lead slot
    // (title and banner) the real thread renders above the transcript.
    ThreadHost: ({
      binding,
      lead
    }: {
      binding: { onConversationId?: (id: string) => void };
      lead?: import('react').ReactNode;
    }) => {
      return (
        <>
          {lead}
          <button type="button" onClick={() => binding.onConversationId?.('conv-forked')}>
            simulate fork
          </button>
        </>
      );
    }
  }));
  const { ShareApp: MockedShareApp } = await import('../src/react/ShareApp.tsx');
  const { userEvent } = await import('@testing-library/user-event');
  const user = userEvent.setup();
  render(<MockedShareApp token="shr_forktoken" />);
  await screen.findByRole('heading', { name: 'Bison across the archive' });
  await user.click(screen.getByRole('button', { name: 'simulate fork' }));
  await screen.findByText(/Tucked into your chats/);
  const open = screen.getByRole('link', { name: 'Open in Thingy' });
  expect(open.getAttribute('href')).toBe('/chat/?conversation=conv-forked');
  vi.doUnmock('../src/react/components/Thread.tsx');
  vi.doUnmock('../src/shared/thingy-session.ts');
});
