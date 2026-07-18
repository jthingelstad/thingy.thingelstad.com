import { mountChatApp } from './components/ChatApp.tsx';

function bootChat() {
  mountChatApp(document.getElementById('main-content'));
}

export { bootChat };
