import { mountDiscordApp } from './components/DiscordApp.tsx';
export { discordSignInUrl, normalizeDiscordCode } from './thingy-discord-links.ts';

function bootDiscord() {
  mountDiscordApp(document.getElementById('main-content'));
}

export { bootDiscord };
