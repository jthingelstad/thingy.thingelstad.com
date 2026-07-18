import { mountSignInApp } from './components/SignInApp.tsx';

function bootSignIn() {
  mountSignInApp(document.getElementById('main-content'));
}

export { bootSignIn };
