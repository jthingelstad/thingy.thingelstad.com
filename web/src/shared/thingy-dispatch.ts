import { mountDispatchApp } from './components/DispatchApp.tsx';

function bootDispatch() {
  mountDispatchApp(document.getElementById('main-content'));
}

export { bootDispatch };
