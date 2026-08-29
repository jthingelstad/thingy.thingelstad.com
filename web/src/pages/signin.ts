import '../styles/thingy-signin-entry.css';
import { bootSignIn } from '../shared/thingy-signin.ts';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.ts';

bootSignIn();
loadTinylytics();
