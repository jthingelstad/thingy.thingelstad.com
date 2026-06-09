import * as session from './thingy-session.js';
import { hasSupportingAccess } from './thingy-account.js';

const copy = document.getElementById('thingy-discord-copy');
const message = document.getElementById('thingy-discord-message');
const codeWrap = document.getElementById('thingy-discord-code');
const codeValue = document.getElementById('thingy-discord-code-value');
const commandWrap = document.getElementById('thingy-discord-command');
const commandValue = document.getElementById('thingy-discord-command-value');
const copyCommandButton = document.getElementById('thingy-discord-copy-command');

function discordConfirmCommand(code) {
  const clean = String(code || '').trim();
  return clean ? `/thingy confirm ${clean}` : '';
}

function setMessage(text, kind = '') {
  if (!message) return;
  message.textContent = text || '';
  message.dataset.kind = kind;
}

function setCopy(text) {
  if (copy) copy.textContent = text || '';
}

async function refreshProfile() {
  if (!session.token() || session.tokenExpired()) return session.storedProfile();
  try {
    const data = await session.postJson('/auth', { action: 'refresh_session' }, session.authHeaders());
    session.persistAuth(data, session.storedEmail());
  } catch (error) {
    // Fall back to the cached profile; the code request below will surface auth failures.
  }
  return session.storedProfile();
}

function renderDiscordCommand(code) {
  const command = discordConfirmCommand(code);
  if (!command) {
    if (codeWrap) codeWrap.hidden = true;
    if (commandWrap) commandWrap.hidden = true;
    if (codeValue) codeValue.textContent = '';
    if (commandValue) commandValue.textContent = '';
    return '';
  }
  if (codeWrap) codeWrap.hidden = false;
  if (codeValue) codeValue.textContent = code;
  if (commandWrap) commandWrap.hidden = false;
  if (commandValue) commandValue.textContent = command;
  return command;
}

async function copyText(value) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(value);
    return true;
  }
  return false;
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
    const code = String(data.code || '').trim();
    const command = renderDiscordCommand(code);
    if (!command) throw new Error('Thingy did not return a Discord verification code. Run /thingy verify again.');
    setCopy('Paste this command back into Discord.');
    setMessage('The code expires soon and only works for the Discord account that started verification.', 'success');
    if (data.profile) session.updateStoredProfile(data.profile);
  } catch (error) {
    renderDiscordCommand('');
    setCopy('Thingy could not create a Discord verification code.');
    setMessage(error.message || 'Run /thingy verify again in Discord.', 'error');
  }
}

if (copyCommandButton) {
  copyCommandButton.addEventListener('click', async () => {
    const command = String(commandValue?.textContent || '').trim();
    if (!command) return;
    try {
      const copied = await copyText(command);
      setMessage(copied ? 'Copied the Discord command.' : 'Copy is not available in this browser. Select the command and copy it manually.', copied ? 'success' : 'error');
    } catch (error) {
      setMessage('Copy failed. Select the command and copy it manually.', 'error');
    }
  });
}

initDiscordLink();

export {
  discordConfirmCommand
};
