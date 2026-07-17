import * as session from './thingy-session.ts';
import { discordConnection, discordConnectionName, hasSupportingAccess } from './thingy-account.ts';

const copy = document.getElementById('thingy-discord-copy');
const message = document.getElementById('thingy-discord-message');
const signInWrap = document.getElementById('thingy-discord-signin');
const signInLink = document.getElementById('thingy-discord-signin-link') as HTMLAnchorElement;
const codeWrap = document.getElementById('thingy-discord-code');
const codeValue = document.getElementById('thingy-discord-code-value');
const copyCodeButton = document.getElementById('thingy-discord-copy-code');
const connectCopy =
  'To connect to the Weekly Thing Supporting Member special Discord, join the server, run <code>/thingy verify</code> in the validation channel, and open the link Thingy gives you.';

function normalizeDiscordCode(code) {
  return String(code || '').trim();
}

function setMessage(text, kind = '') {
  if (!message) return;
  message.textContent = text || '';
  message.dataset.kind = kind;
}

function setCopy(text) {
  if (copy) copy.textContent = text || '';
}

function setCopyHtml(html) {
  if (copy) copy.innerHTML = html || '';
}

function renderSignIn(state = '') {
  if (signInWrap) signInWrap.hidden = false;
  if (signInLink) signInLink.href = discordSignInUrl(state);
}

function hideSignIn() {
  if (signInWrap) signInWrap.hidden = true;
}

async function refreshProfile() {
  // Falls back to the cached profile on failure; the code request below
  // will surface auth failures.
  await session.refreshAuth();
  return session.storedProfile();
}

function renderDiscordCode(code) {
  const clean = normalizeDiscordCode(code);
  if (!clean) {
    if (codeWrap) codeWrap.hidden = true;
    if (codeValue) codeValue.textContent = '';
    return '';
  }
  if (codeWrap) codeWrap.hidden = false;
  if (codeValue) codeValue.textContent = clean;
  return clean;
}

async function copyText(value) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(value);
    return true;
  }
  return false;
}

function discordSignInUrl(state = '') {
  const url = new URL('/signin/', window.location.origin);
  const cleanState = String(state || '').trim();
  url.searchParams.set('return', `/discord/${cleanState ? `?state=${encodeURIComponent(cleanState)}` : ''}`);
  return url.toString();
}

function authStateReason() {
  if (!session.token()) return 'No Thingy session was found in this browser.';
  if (session.tokenExpired()) return 'Your Thingy session in this browser is expired.';
  return '';
}

async function initDiscordLink() {
  const params = new URLSearchParams(window.location.search);
  const state = String(params.get('state') || '').trim();

  const authReason = authStateReason();
  if (authReason) {
    renderDiscordCode('');
    renderSignIn(state);
    setCopy('Sign in to Thingy in this browser to finish connecting Discord.');
    setMessage(
      `${authReason} The sign-in link will return here with your Discord verification state preserved.`,
      'error'
    );
    return;
  }

  hideSignIn();
  const profile = await refreshProfile();
  if (!hasSupportingAccess(profile)) {
    setCopyHtml(
      'The Weekly Thing Supporting Member special Discord is an exclusive benefit for <a href="https://weekly.thingelstad.com/members/">Supporting Members</a>. Join or manage your membership, then sign in again so Thingy can refresh your account.'
    );
    setMessage(
      'If you recently became a Supporting Member, sign out and sign back in so Thingy can refresh your account.',
      'error'
    );
    return;
  }

  if (!state) {
    const connection = discordConnection(profile);
    const connectedName = discordConnectionName(profile);
    if (connection) {
      setCopy(connectedName ? `You are connected to Discord as ${connectedName}.` : 'You are connected to Discord.');
    } else {
      setCopyHtml(connectCopy);
    }
    setMessage('Thingy will generate a one-time code after you start from Discord.', connection ? 'success' : '');
    return;
  }

  setCopy('Generating a one-time verification code.');
  try {
    const data = await session.postJson(
      '/auth',
      {
        action: 'discord_link_code',
        state,
        email: session.storedEmail()
      },
      session.authHeaders()
    );
    const code = renderDiscordCode(data.code);
    if (!code) throw new Error('Thingy did not return a Discord verification code. Run /thingy verify again.');
    setCopy('Copy this code, then use /thingy confirm in Discord and paste it into the code field.');
    setMessage('The code expires soon and only works for the Discord account that started verification.', 'success');
    if (data.profile) session.updateStoredProfile(data.profile);
  } catch (error) {
    renderDiscordCode('');
    setCopy('Thingy could not create a Discord verification code.');
    setMessage(error.message || 'Run /thingy verify again in Discord.', 'error');
  }
}

if (copyCodeButton) {
  copyCodeButton.addEventListener('click', async () => {
    const code = normalizeDiscordCode(codeValue?.textContent);
    if (!code) return;
    try {
      const copied = await copyText(code);
      setMessage(
        copied
          ? 'Copied the verification code.'
          : 'Copy is not available in this browser. Select the code and copy it manually.',
        copied ? 'success' : 'error'
      );
    } catch (error) {
      setMessage('Copy failed. Select the code and copy it manually.', 'error');
    }
  });
}

initDiscordLink();

export { normalizeDiscordCode, discordSignInUrl };
