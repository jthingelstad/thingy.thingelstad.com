import '../styles/thingy.css';
import { bootDispatch } from '../shared/thingy-dispatch.ts';
import { loadTinylytics } from '../shared/thingy-tinylytics-loader.ts';

bootDispatch();
loadTinylytics();
