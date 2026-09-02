import '../styles/thingy-share-entry.css';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { registerClientErrorTracking } from '../shared/thingy-analytics.ts';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.ts';
import { ShareApp } from '../react/ShareApp.tsx';

registerClientErrorTracking('share');
const root = document.getElementById('thingy-shared-root');
if (root) createRoot(root).render(createElement(ShareApp));
loadTinylytics();
