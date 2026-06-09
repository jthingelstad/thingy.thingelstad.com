import * as session from './thingy-session.js';
import { hasSupportingAccess } from './thingy-account.js';

const copy = document.getElementById('thingy-discord-copy');
const message = document.getElementById('thingy-discord-message');
const codeWrap = document.getElementById('thingy-discord-code');
const codeValue = document.getElementById('thingy-discord-code-value');

function setMessage(text, kind = '') {
  if (!message) return;
  message.textContent = text || '';
  message.dataset.kind = kind;
}

function setCopy(text) {
  if (copy) copy.textContent = text || '';
}

async function refreshProfile() {
  if (!(await session.ensureFreshToken())) return session.storedProfile();
  return session.storedProfile();
}

async function initDiscordLink() {
  const params = new URLSearchParams(window.location.search);
  const state = String(params.get('state') || '').trim();

  if (!session.token() || session.tokenExpired()) {
    window.location.href = session.signInUrl(`/discord/${state ? `?state=${encodeURIComponent(state)}` : ''}`);
    return;
  }

  const profile = await refreshProfile();
  if (!hasSupportingAccess(profile)) {
    setCopy('Discord is available to Weekly Thing Supporting Members.');
    setMessage('If you recently became a Supporting Member, sign out and sign back in so Thingy can refresh your account.', 'error');
    return;
  }

  if (!state) {
    const connection = profile.discord_connection || {};
    const connectedName = String(connection.display_name || connection.global_name || connection.username || '').trim();
    setCopy(connectedName
      ? `You are connected to Discord as ${connectedName}.`
      : 'To connect Discord, run /thingy verify in the validation channel and open the link Thingy gives you.');
    setMessage('Thingy will generate a one-time code after you start from Discord.', connectedName ? 'success' : '');
    return;
  }

  setCopy('Generating a one-time verification code.');
  try {
    const data = await session.postJson('/auth', {
      action: 'discord_link_code',
      state,
      email: session.storedEmail()
    }, session.authHeaders());
    if (codeWrap) codeWrap.hidden = false;
    if (codeValue) codeValue.textContent = data.code || '';
    setCopy('Paste this code back into Discord with /thingy confirm.');
    setMessage('The code expires soon and only works for the Discord account that started verification.', 'success');
    if (data.profile) session.updateStoredProfile(data.profile);
  } catch (error) {
    setCopy('Thingy could not create a Discord verification code.');
    setMessage(error.message || 'Run /thingy verify again in Discord.', 'error');
  }
}

initDiscordLink();
