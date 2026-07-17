import '../styles/thingy.css';
import { hydrateThingyIcons } from '../shared/thingy-icons.ts';
import { bootChat } from '../shared/thingy-chat.ts';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.ts';

hydrateThingyIcons();
bootChat();
loadTinylytics();
