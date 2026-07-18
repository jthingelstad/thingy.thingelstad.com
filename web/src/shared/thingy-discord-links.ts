function normalizeDiscordCode(code: unknown) {
  return String(code || '').trim();
}

function discordSignInUrl(state = '') {
  const url = new URL('/signin/', window.location.origin);
  const cleanState = String(state || '').trim();
  url.searchParams.set('return', `/discord/${cleanState ? `?state=${encodeURIComponent(cleanState)}` : ''}`);
  return url.toString();
}

export { discordSignInUrl, normalizeDiscordCode };
