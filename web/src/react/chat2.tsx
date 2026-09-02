import { createRoot } from 'react-dom/client';
import '../styles/thingy.css';
import '../styles/thingy-aui.css';
import { registerClientErrorTracking } from '../shared/thingy-analytics.ts';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.ts';
import { Chat2App } from './Chat2App.tsx';

registerClientErrorTracking('chat2');
const host = document.getElementById('thingy-react-root');
if (host) createRoot(host).render(<Chat2App />);
loadTinylytics();
