// /connect/reference/: the page body is rendered at build time from the
// vendored MCP surface (vite.mcp-reference.ts); this boot only styles and
// counts it.
import '../styles/thingy-page-entry.css';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.ts';

loadTinylytics();
