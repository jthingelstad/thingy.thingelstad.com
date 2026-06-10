import '../styles/thingy.css';
import { hydrateThingyIcons } from '../shared/thingy-icons.js';
import { bootChat } from '../shared/thingy-chat.js';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.js';

hydrateThingyIcons();
loadTinylytics();
bootChat();
