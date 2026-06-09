import * as defaultSession from './thingy-session.js';

function hasSupportingAccess(profile = {}) {
    const entitlements = Array.isArray(profile.entitlements) ? profile.entitlements : [];
    return Boolean(profile.supporting_member || entitlements.includes('supporting_member') || entitlements.includes('owner'));
  }

function normalizePreferredName(value) {
    const candidate = String(value || '').trim().replace(/[.!]+$/, '').replace(/\s+/g, ' ');
    if (!/^[a-z][a-z .'’-]{0,78}$/i.test(candidate)) return '';
    const words = candidate.split(/\s+/).filter(Boolean);
    if (words.length < 1 || words.length > 4) return '';
    const blocked = new Set(['hello', 'hi', 'hey', 'there', 'thingy', 'thanks', 'thank', 'yes', 'no', 'ok', 'okay']);
    if (words.some((word) => blocked.has(word.toLowerCase()))) return '';
    return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }

function extractPreferredNameFromMessage(message) {
    const text = String(message || '').trim();
    if (!text || text.length > 80 || /[?]/.test(text)) return '';
    const direct = text.match(/^(?:my name is|i am|i'm|call me)\s+(.+?)[.!]?$/i);
    return normalizePreferredName(direct ? direct[1] : text);
  }

function renderAccountIdentity(options = {}) {
    const profile = options.profile || {};
    const elements = options.elements || {};
    const signedIn = Boolean(options.signedIn);
    const email = String(options.email || '').trim();
    const preferredName = String(options.preferredName || profile.preferred_name || '').trim();
    const display = email || preferredName;
    if (elements.email) elements.email.textContent = signedIn ? (display || 'Signed in') : (options.signedOutEmail || 'Sign in');
    if (elements.sub) {
      elements.sub.textContent = signedIn
        ? hasSupportingAccess(profile) ? 'Supporting Member' : 'Weekly Thing reader'
        : (options.signedOutSub || 'Weekly Thing readers');
    }
    if (elements.avatar) elements.avatar.textContent = signedIn && display ? display[0].toUpperCase() : 'T';
    if (elements.nameInput) elements.nameInput.value = preferredName;
    if (elements.discordRow) {
      const visible = signedIn && hasSupportingAccess(profile);
      elements.discordRow.hidden = !visible;
      const connection = profile.discord_connection && typeof profile.discord_connection === 'object'
        ? profile.discord_connection
        : null;
      const connectedName = String(connection?.display_name || connection?.global_name || connection?.username || '').trim();
      if (elements.discordStatus) {
        elements.discordStatus.textContent = connectedName
          ? `Connected as ${connectedName}`
          : 'Supporting Members can connect Discord.';
      }
      if (elements.discordLink) {
        elements.discordLink.textContent = connectedName ? 'Refresh Discord Connection' : 'Link to Discord';
        elements.discordLink.href = '/discord/';
      }
    }
    if (elements.caret) elements.caret.hidden = !signedIn;
    if (elements.button) {
      elements.button.setAttribute('aria-haspopup', signedIn ? 'true' : 'false');
      elements.button.setAttribute('aria-expanded', 'false');
      elements.button.title = signedIn ? 'Account' : 'Sign in';
    }
  }

async function savePreferredName(session, name, normalizeName = normalizePreferredName) {
    const nextName = normalizeName(name);
    if (!nextName) throw new Error('Enter a name Thingy should use.');
    const data = await session.postJson('/auth', { action: 'update_profile', preferred_name: nextName }, session.authHeaders());
    const savedName = String(data?.profile?.preferred_name || '').trim();
    if (savedName.toLowerCase() !== nextName.toLowerCase()) {
      throw new Error('Thingy could not confirm that name was saved. Please try again.');
    }
    session.updateStoredProfile({ ...(data.profile || {}), preferred_name: savedName });
    return { data, savedName };
  }

function createAccountMenu(options = {}) {
    const session = options.session || defaultSession;
    const button = options.button || null;
    const menu = options.menu || null;
    const nameForm = options.nameForm || null;
    const nameInput = options.nameInput || null;
    const nameStatus = options.nameStatus || null;
    const logoutButton = options.logoutButton || null;
    const normalizeName = typeof options.normalizeName === 'function'
      ? options.normalizeName
      : (value) => String(value || '').trim();
    const signedIn = typeof options.signedIn === 'function'
      ? options.signedIn
      : () => Boolean(session?.token?.());
    const onSaved = typeof options.onSaved === 'function' ? options.onSaved : () => {};
    const onOpen = typeof options.onOpen === 'function' ? options.onOpen : () => {};
    const onSignedOutClick = typeof options.onSignedOutClick === 'function' ? options.onSignedOutClick : () => {};
    const onLogout = typeof options.onLogout === 'function'
      ? options.onLogout
      : () => {
        session.clearAuth();
        window.location.href = session.signInUrl(options.returnTo || '/chat/');
      };

    function toggle(force) {
      if (!menu) return;
      const open = force === undefined ? menu.hasAttribute('hidden') : Boolean(force);
      menu.toggleAttribute('hidden', !open);
      if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) onOpen();
    }

    if (button) {
      button.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!signedIn()) {
          toggle(false);
          onSignedOutClick();
          return;
        }
        toggle();
      });
    }

    if (menu) menu.addEventListener('click', (event) => event.stopPropagation());

    if (nameForm) {
      nameForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!signedIn()) return;
        const nextName = nameInput?.value || '';
        if (nameStatus) nameStatus.textContent = 'Saving...';
        try {
          const { data, savedName } = await savePreferredName(session, nextName, normalizeName);
          onSaved(savedName, data);
          if (nameStatus) nameStatus.textContent = 'Saved.';
        } catch (error) {
          if (nameStatus) nameStatus.textContent = error.message || 'Could not save that right now.';
        }
      });
    }

    if (logoutButton) {
      logoutButton.addEventListener('click', onLogout);
    }

    return {
      close: () => toggle(false),
      toggle
    };
  }

function createAccountPanel(options = {}) {
    const controls = createAccountMenu(options);
    return {
      ...controls,
      refresh: (state = {}) => renderAccountIdentity({
        signedIn: Boolean(state.signedIn),
        email: state.email,
        profile: state.profile,
        preferredName: state.preferredName,
        signedOutEmail: state.signedOutEmail,
        signedOutSub: state.signedOutSub,
        elements: options.elements || {}
      })
    };
  }

export {
  createAccountPanel,
  createAccountMenu,
  extractPreferredNameFromMessage,
  hasSupportingAccess,
  normalizePreferredName,
  renderAccountIdentity,
  savePreferredName
};
