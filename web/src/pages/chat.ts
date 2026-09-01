import '../styles/thingy.css';
import { registerClientErrorTracking } from '../shared/thingy-analytics.ts';
import { bootChat } from '../shared/thingy-chat.ts';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.ts';
import { bootWebMcp } from '../shared/thingy-webmcp.ts';

registerClientErrorTracking('chat');
bootChat();
loadTinylytics();
void bootWebMcp();
