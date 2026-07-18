// @ts-check
// Pure account-identity helpers reused by the AccountMenu component, the
// chat bootstrap (for preferred-name inference from messages), and the
// Discord verification page. The previous createAccountPanel /
// createAccountMenu / renderAccountIdentity factories were deleted when
// AccountMenu.jsx took over the imperative rendering.

function hasSupportingAccess(profile: LibrarianProfile = {}): boolean {
  const entitlements = Array.isArray(profile.entitlements) ? profile.entitlements : [];
  return Boolean(
    profile.supporting_member || entitlements.includes('supporting_member') || entitlements.includes('owner')
  );
}

function hasOwnerAccess(profile: LibrarianProfile = {}): boolean {
  const entitlements = Array.isArray(profile.entitlements) ? profile.entitlements : [];
  return entitlements.includes('owner');
}

function discordConnection(profile: LibrarianProfile = {}): LibrarianDiscordConnection | null {
  const candidates = [profile.discord_connection, profile.discordConnection, profile.discord_user, profile.discordUser];
  const connection = candidates.find((value) => value && typeof value === 'object') || null;
  if (!connection || connection.connected === false) return null;
  const username = String(connection.username || connection.user_name || '').trim();
  const globalName = String(connection.global_name || connection.globalName || '').trim();
  const displayName = String(connection.display_name || connection.displayName || globalName || username).trim();
  const connectedAt = String(connection.connected_at || connection.connectedAt || '').trim();
  if (!displayName && !username && !globalName && connection.connected !== true && !connectedAt) return null;
  return {
    ...connection,
    username,
    global_name: globalName,
    display_name: displayName || username || globalName,
    connected_at: connectedAt
  };
}

function discordConnectionName(profile: LibrarianProfile = {}): string {
  return String(discordConnection(profile)?.display_name || '').trim();
}

function normalizePreferredName(value: unknown): string {
  const candidate = String(value || '')
    .trim()
    .replace(/[.!]+$/, '')
    .replace(/\s+/g, ' ');
  if (!/^[a-z][a-z .'’-]{0,78}$/i.test(candidate)) return '';
  const words = candidate.split(/\s+/).filter(Boolean);
  if (words.length < 1 || words.length > 4) return '';
  const blocked = new Set(['hello', 'hi', 'hey', 'there', 'thingy', 'thanks', 'thank', 'yes', 'no', 'ok', 'okay']);
  if (words.some((word) => blocked.has(word.toLowerCase()))) return '';
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

function extractPreferredNameFromMessage(message: unknown): string {
  const text = String(message || '').trim();
  if (!text || text.length > 80 || /[?]/.test(text)) return '';
  const direct = text.match(/^(?:my name is|i am|i'm|call me)\s+(.+?)[.!]?$/i);
  return normalizePreferredName(direct ? direct[1] : text);
}

async function savePreferredName(
  session: typeof import('./thingy-session.ts'),
  name: unknown,
  normalizeName: (value: unknown) => string = normalizePreferredName
) {
  const nextName = normalizeName(name);
  if (!nextName) throw new Error('Enter a name Thingy should use.');
  const data = await session.postJson(
    '/auth',
    { action: 'update_profile', preferred_name: nextName },
    session.authHeaders()
  );
  const savedName = String(data?.profile?.preferred_name || '').trim();
  if (savedName.toLowerCase() !== nextName.toLowerCase()) {
    throw new Error('Thingy could not confirm that name was saved. Please try again.');
  }
  session.updateStoredProfile({ ...(data.profile || {}), preferred_name: savedName });
  return { data, savedName };
}

export {
  discordConnection,
  discordConnectionName,
  extractPreferredNameFromMessage,
  hasOwnerAccess,
  hasSupportingAccess,
  normalizePreferredName,
  savePreferredName
};
