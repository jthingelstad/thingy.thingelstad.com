import '../styles/thingy-signin-entry.css';
import { registerClientErrorTracking } from '../shared/thingy-analytics.ts';
import { bootSignIn } from '../shared/thingy-signin.ts';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.ts';
import { initTheme } from '../shared/thingy-theme.ts';

initTheme();

registerClientErrorTracking('signin');
bootSignIn();
loadTinylytics();
