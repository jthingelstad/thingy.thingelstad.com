import '../styles/thingy.css';
import { hydrateThingyIcons } from '../shared/thingy-icons.js';
import '../shared/thingy-dispatch.js';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.js';

hydrateThingyIcons();
loadTinylytics();
