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

const { SignInApp } = await import('../src/react/SignInApp.tsx');

beforeEach(() => {
  postJson.mockReset();
});

afterEach(cleanup);

test('rejects an invalid email locally without calling the server', async () => {
  const user = userEvent.setup();
  render(<SignInApp />);
  // 'a@b' passes native type=email validation but fails Thingy's stricter
  // regex - exercising the local check (a fully invalid string is blocked
  // by the browser before our handler runs).
  await user.type(screen.getByLabelText('Email address'), 'a@b');
  await user.click(screen.getByRole('button', { name: 'Send Link' }));
  await screen.findByText('Enter a valid email address.');
  expect(postJson).not.toHaveBeenCalled();
});

test('magic_link_sent reveals the six-digit code entry', async () => {
  const user = userEvent.setup();
  postJson.mockResolvedValueOnce({ status: 'magic_link_sent' });
  render(<SignInApp />);
  await user.type(screen.getByLabelText('Email address'), 'reader@example.com');
  await user.click(screen.getByRole('button', { name: 'Send Link' }));
  await screen.findByText(/enter the sign-in code below/);
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
  await user.click(screen.getByRole('button', { name: 'Send Link' }));
  await screen.findByRole('button', { name: 'Add Me to The Weekly Thing' });
});

test('unconfirmed offers resend confirmation', async () => {
  const user = userEvent.setup();
  postJson.mockResolvedValueOnce({ status: 'unconfirmed' });
  render(<SignInApp />);
  await user.type(screen.getByLabelText('Email address'), 'pending@example.com');
  await user.click(screen.getByRole('button', { name: 'Send Link' }));
  await screen.findByRole('button', { name: 'Resend Confirmation' });
});

test('a server error surfaces as a readable message', async () => {
  const user = userEvent.setup();
  postJson.mockRejectedValueOnce(new Error('Thingy is unavailable.'));
  render(<SignInApp />);
  await user.type(screen.getByLabelText('Email address'), 'reader@example.com');
  await user.click(screen.getByRole('button', { name: 'Send Link' }));
  await screen.findByText('Thingy is unavailable.');
});
