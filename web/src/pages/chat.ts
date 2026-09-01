import '../styles/thingy.css';
import { bootChat } from '../shared/thingy-chat.ts';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.ts';
import { bootWebMcp } from '../shared/thingy-webmcp.ts';

bootChat();
loadTinylytics();
void bootWebMcp();
