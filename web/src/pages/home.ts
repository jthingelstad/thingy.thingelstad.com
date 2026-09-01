import '../styles/thingy-home-entry.css';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.ts';
import { refreshAuth, sessionActive } from '../shared/thingy-session.ts';

loadTinylytics();

// Any visit slides the 9-day session window, not just /chat/ - a signed-in
// reader landing on the home page stays signed in.
if (sessionActive()) {
  void refreshAuth();
}
