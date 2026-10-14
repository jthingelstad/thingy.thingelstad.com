import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const postJson = vi.fn();

vi.mock('../src/shared/thingy-session.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/shared/thingy-session.ts')>();
  return {
    ...actual,
    postJson: (...args: unknown[]) => postJson(...args),
    sessionActive: () => false,
    storedEmail: () => '',
    persistAuth: vi.fn()
  };
});

const tokenFor = vi.fn();
const resetTurnstile = vi.fn();

// Cloudflare's script never loads in happy-dom; stand in for the widget.
vi.mock('../src/shared/turnstile.ts', () => ({
  useTurnstile: () => ({
    slotRef: { current: null },
    turnstile: { warm: () => {}, tokenFor: (email: string) => tokenFor(email), reset: () => resetTurnstile() }
  })
}));

const { SignInApp } = await import('../src/react/SignInApp.tsx');

beforeEach(() => {
  postJson.mockReset();
  tokenFor.mockReset();
  tokenFor.mockResolvedValue('');
  resetTurnstile.mockReset();
});

afterEach(cleanup);

test('rejects an invalid email locally without calling the server', async () => {
  const user = userEvent.setup();
  render(<SignInApp />);
  // 'a@b' passes native type=email validation but fails Thingy's stricter
  // regex - exercising the local check (a fully invalid string is blocked
  // by the browser before our handler runs).
  await user.type(screen.getByLabelText('Email address'), 'a@b');
  await user.click(screen.getByRole('button', { name: 'Email Me a Code' }));
  await screen.findByText('Enter a valid email address.');
  expect(postJson).not.toHaveBeenCalled();
});

test('magic_link_sent reveals the six-digit code entry', async () => {
  const user = userEvent.setup();
  postJson.mockResolvedValueOnce({ status: 'magic_link_sent' });
  render(<SignInApp />);
  await user.type(screen.getByLabelText('Email address'), 'reader@example.com');
  await user.click(screen.getByRole('button', { name: 'Email Me a Code' }));
  await screen.findByText(/Enter the six-digit code below/);
  const codeInput = await screen.findByLabelText('Sign-in code');
  // The Sign In button stays disabled until six digits are present.
  const signIn = screen.getByRole('button', { name: 'Sign In' });
  expect((signIn as HTMLButtonElement).disabled).toBe(true);
  await user.type(codeInput, '123456');
  expect((signIn as HTMLButtonElement).disabled).toBe(false);
});

test('not_found offers the subscribe path', async () => {
  const user = userEvent.setup();
  postJson.mockResolvedValueOnce({ status: 'not_found' });
  render(<SignInApp />);
  await user.type(screen.getByLabelText('Email address'), 'new@example.com');
  await user.click(screen.getByRole('button', { name: 'Email Me a Code' }));
  await screen.findByRole('button', { name: 'Add Me to The Weekly Thing' });
});

test('unconfirmed offers resend confirmation', async () => {
  const user = userEvent.setup();
  postJson.mockResolvedValueOnce({ status: 'unconfirmed' });
  render(<SignInApp />);
  await user.type(screen.getByLabelText('Email address'), 'pending@example.com');
  await user.click(screen.getByRole('button', { name: 'Email Me a Code' }));
  await screen.findByRole('button', { name: 'Resend Confirmation' });
});

test('a server error surfaces as a readable message', async () => {
  const user = userEvent.setup();
  postJson.mockRejectedValueOnce(new Error('Thingy is unavailable.'));
  render(<SignInApp />);
  await user.type(screen.getByLabelText('Email address'), 'reader@example.com');
  await user.click(screen.getByRole('button', { name: 'Email Me a Code' }));
  await screen.findByText('Thingy is unavailable.');
});

test('the email request carries the Turnstile token when there is one', async () => {
  const user = userEvent.setup();
  tokenFor.mockResolvedValue('turnstile-token');
  postJson.mockResolvedValueOnce({ status: 'not_found' });
  render(<SignInApp />);
  await user.type(screen.getByLabelText('Email address'), 'Reader@Example.com');
  await user.click(screen.getByRole('button', { name: 'Email Me a Code' }));
  await screen.findByRole('button', { name: 'Add Me to The Weekly Thing' });
  expect(tokenFor).toHaveBeenCalledWith('reader@example.com');
  expect(postJson.mock.calls[0][1]).toMatchObject({ action: 'check', turnstile_token: 'turnstile-token' });
});

test('without a token the request still goes, with no token field', async () => {
  const user = userEvent.setup();
  postJson.mockResolvedValueOnce({ status: 'magic_link_sent' });
  render(<SignInApp />);
  await user.type(screen.getByLabelText('Email address'), 'reader@example.com');
  await user.click(screen.getByRole('button', { name: 'Email Me a Code' }));
  await screen.findByText(/Enter the six-digit code below/);
  expect(postJson.mock.calls[0][1]).not.toHaveProperty('turnstile_token');
});

test('a Turnstile refusal shows the reason and resets the widget', async () => {
  const user = userEvent.setup();
  const refusal = new Error('We couldn’t confirm this request came from a person.');
  refusal.status = 403;
  refusal.data = { status: 'turnstile_failed' };
  postJson.mockRejectedValueOnce(refusal);
  render(<SignInApp />);
  await user.type(screen.getByLabelText('Email address'), 'reader@example.com');
  await user.click(screen.getByRole('button', { name: 'Email Me a Code' }));
  await screen.findByText(/confirm this request came from a person/);
  expect(resetTurnstile).toHaveBeenCalledTimes(1);
});

test('a firewalled address is told it is under review, as a notice', async () => {
  const user = userEvent.setup();
  const review = new Error('This email address was flagged as suspicious and has been recorded for review.');
  review.status = 403;
  review.data = { status: 'inactive', under_review: true };
  postJson.mockRejectedValueOnce(review);
  render(<SignInApp />);
  await user.type(screen.getByLabelText('Email address'), 'flagged@example.com');
  await user.click(screen.getByRole('button', { name: 'Email Me a Code' }));
  const text = await screen.findByText(/recorded for review/);
  expect(text.closest('[data-kind]')?.getAttribute('data-kind')).toBe('notice');
});

test('needs_jamie from subscribe shows the Librarian’s words', async () => {
  const user = userEvent.setup();
  postJson.mockResolvedValueOnce({ status: 'not_found' });
  postJson.mockResolvedValueOnce({ status: 'needs_jamie', error: 'Recorded for review; not subscribed yet.' });
  render(<SignInApp />);
  await user.type(screen.getByLabelText('Email address'), 'flagged@example.com');
  await user.click(screen.getByRole('button', { name: 'Email Me a Code' }));
  await user.click(await screen.findByRole('button', { name: 'Add Me to The Weekly Thing' }));
  await screen.findByText('Recorded for review; not subscribed yet.');
});
