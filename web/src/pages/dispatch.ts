import '../styles/thingy.css';
import { hydrateThingyIcons } from '../shared/thingy-icons.ts';
import { bootDispatch } from '../shared/thingy-dispatch.ts';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.ts';

hydrateThingyIcons();
bootDispatch();
loadTinylytics();
