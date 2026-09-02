import '../styles/thingy-home-entry.css';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.ts';
import { refreshAuth, sessionActive } from '../shared/thingy-session.ts';
import { initTheme } from '../shared/thingy-theme.ts';

initTheme();

// Emailed magic links land here (THINGY_MAGIC_LINK_BASE_URL is the site
// root). Hand the token to the sign-in route before analytics scrubs it.
const magicBoot = new URLSearchParams(window.location.search);
const magicToken = String(magicBoot.get('login_token') || magicBoot.get('magic_token') || '').trim();
if (magicToken) {
  window.location.replace(`/signin/?login_token=${encodeURIComponent(magicToken)}`);
}

loadTinylytics();

// Any visit slides the 9-day session window, not just /chat/ - a signed-in
// reader landing on the home page stays signed in.
if (sessionActive()) {
  void refreshAuth();
}
