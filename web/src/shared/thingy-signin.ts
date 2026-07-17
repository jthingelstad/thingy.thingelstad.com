import * as session from './thingy-session.ts';
import { errorMessage } from './thingy-errors.ts';

const form = document.getElementById('thingy-signin-form') as HTMLFormElement;
const emailInput = document.getElementById('thingy-signin-email') as HTMLInputElement;
const submitButton = document.getElementById('thingy-signin-submit') as HTMLButtonElement;
const message = document.getElementById('thingy-signin-message');
const secondary = document.getElementById('thingy-signin-secondary');
const resendButton = document.getElementById('thingy-signin-resend') as HTMLButtonElement;
const subscribeButton = document.getElementById('thingy-signin-subscribe') as HTMLButtonElement;
const tokenParams = new URLSearchParams(window.location.search);
const loginToken = String(tokenParams.get('login_token') || tokenParams.get('magic_token') || '').trim();
const returnTo = session.returnPath('/chat/');
const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
let lastEmail = session.storedEmail();

function destinationPath() {
  if (!returnTo || returnTo === '/signin/' || returnTo.startsWith('/signin/?')) return '/chat/';
  return session.restorePendingReturnParams(returnTo);
}

function continueToDestination() {
  window.location.replace(destinationPath());
}

function setMessage(text: unknown, kind: string) {
  if (!message) return;
  message.textContent = String(text || '');
  message.dataset.kind = kind || '';
}

function setBusy(busy: boolean) {
  if (submitButton) submitButton.disabled = Boolean(busy);
  if (resendButton) resendButton.disabled = Boolean(busy);
  if (subscribeButton) subscribeButton.disabled = Boolean(busy);
}

function showSecondary(kind: string) {
  if (!secondary) return;
  secondary.hidden = !kind;
  if (resendButton) resendButton.hidden = kind !== 'resend';
  if (subscribeButton) subscribeButton.hidden = kind !== 'subscribe';
}

function finish(data: ThingyAuthData, email: unknown) {
  session.persistAuth(data, session.normalizeEmail(email));
  continueToDestination();
}

function scrubMagicTokenParams() {
  tokenParams.delete('login_token');
  tokenParams.delete('magic_token');
  window.history.replaceState(
    window.history.state,
    document.title,
    `${window.location.pathname}?${tokenParams.toString()}`.replace(/\?$/, '')
  );
}

async function completeMagicLink() {
  if (!loginToken) return;
  setBusy(true);
  setMessage('Signing you in...', 'pending');
  showSecondary('');
  try {
    const data = await session.postJson(
      '/auth',
      {
        action: 'complete_magic_link',
        login_token: loginToken,
        source: 'thingy'
      },
      {}
    );
    if (!data.token) throw new Error(data.message || 'That sign-in link did not return a session.');
    scrubMagicTokenParams();
    finish(data, data.email);
  } catch (error) {
    scrubMagicTokenParams();
    setMessage(errorMessage(error, 'That sign-in link did not work.'), 'error');
    session.clearAuth();
  } finally {
    setBusy(false);
  }
}

async function requestMagicLink(action = 'check') {
  const email = session.normalizeEmail((emailInput && emailInput.value) || lastEmail);
  lastEmail = email;
  if (!emailRe.test(email)) {
    setMessage('Enter a valid email address.', 'error');
    return;
  }
  setBusy(true);
  showSecondary('');
  setMessage(action === 'subscribe' ? 'Adding you to The Weekly Thing...' : 'Checking your access...', 'pending');
  try {
    const data = await session.postJson(
      '/auth',
      {
        action,
        email,
        source: 'thingy',
        return_path: returnTo
      },
      {}
    );
    if (data.token) {
      finish(data, email);
      return;
    }
    if (data.status === 'magic_link_sent') {
      setMessage('Check your email for a private sign-in link from Thingy.', 'success');
      window.localStorage.setItem(session.userEmailKey, email);
      return;
    }
    if (data.status === 'not_found') {
      setMessage('That email is not subscribed yet. Thingy can help add you to The Weekly Thing.', 'notice');
      showSecondary('subscribe');
      return;
    }
    if (data.status === 'unconfirmed') {
      setMessage('Please confirm your Weekly Thing subscription first.', 'notice');
      showSecondary('resend');
      return;
    }
    if (data.status === 'subscribed') {
      setMessage('Check your inbox to confirm your subscription, then come back to sign in.', 'success');
      return;
    }
    setMessage(data.message || 'Check your email for the next step.', 'notice');
  } catch (error) {
    setMessage(errorMessage(error, 'Sign-in is unavailable right now.'), 'error');
  } finally {
    setBusy(false);
  }
}

if (emailInput && lastEmail) emailInput.value = lastEmail;
if (form) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    requestMagicLink('check');
  });
}
if (resendButton) resendButton.addEventListener('click', () => requestMagicLink('resend_confirmation'));
if (subscribeButton) subscribeButton.addEventListener('click', () => requestMagicLink('subscribe'));

if (session.token() && !session.tokenExpired()) {
  setMessage('You are already signed in.', 'success');
  if (!loginToken) continueToDestination();
}
completeMagicLink();
