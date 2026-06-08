(function () {
  const session = window.ThingySession;
  const form = document.getElementById('thingy-signin-form');
  const emailInput = document.getElementById('thingy-signin-email');
  const submitButton = document.getElementById('thingy-signin-submit');
  const message = document.getElementById('thingy-signin-message');
  const secondary = document.getElementById('thingy-signin-secondary');
  const resendButton = document.getElementById('thingy-signin-resend');
  const subscribeButton = document.getElementById('thingy-signin-subscribe');
  const tokenParams = new URLSearchParams(window.location.search);
  const loginToken = String(tokenParams.get('login_token') || tokenParams.get('magic_token') || '').trim();
  const returnTo = session.returnPath('/chat/');
  const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  let lastEmail = session.storedEmail();

  function setMessage(text, kind) {
    if (!message) return;
    message.textContent = text || '';
    message.dataset.kind = kind || '';
  }

  function setBusy(busy) {
    if (submitButton) submitButton.disabled = Boolean(busy);
    if (resendButton) resendButton.disabled = Boolean(busy);
    if (subscribeButton) subscribeButton.disabled = Boolean(busy);
  }

  function showSecondary(kind) {
    if (!secondary) return;
    secondary.hidden = !kind;
    if (resendButton) resendButton.hidden = kind !== 'resend';
    if (subscribeButton) subscribeButton.hidden = kind !== 'subscribe';
  }

  function finish(data, email) {
    session.persistAuth(data, email);
    window.location.href = returnTo;
  }

  async function completeMagicLink() {
    if (!loginToken) return;
    setBusy(true);
    setMessage('Signing you in...', 'pending');
    try {
      const data = await session.postJson('/auth', {
        action: 'complete_magic_link',
        login_token: loginToken,
        source: 'thingy'
      });
      tokenParams.delete('login_token');
      tokenParams.delete('magic_token');
      window.history.replaceState(window.history.state, document.title, `${window.location.pathname}?${tokenParams.toString()}`.replace(/\?$/, ''));
      finish(data, data.email);
    } catch (error) {
      setMessage(error.message || 'That sign-in link did not work.', 'error');
      session.clearAuth();
    } finally {
      setBusy(false);
    }
  }

  async function requestMagicLink(action = 'check') {
    const email = session.normalizeEmail(emailInput && emailInput.value || lastEmail);
    lastEmail = email;
    if (!emailRe.test(email)) {
      setMessage('Enter a valid email address.', 'error');
      return;
    }
    setBusy(true);
    showSecondary('');
    setMessage(action === 'subscribe' ? 'Adding you to The Weekly Thing...' : 'Checking your access...', 'pending');
    try {
      const data = await session.postJson('/auth', {
        action,
        email,
        source: 'thingy',
        return_path: returnTo
      });
      if (data.token) {
        finish(data, email);
        return;
      }
      if (data.status === 'magic_link_sent') {
        setMessage('Check your email for a private sign-in link from Thingy.', 'success');
        window.localStorage.setItem(session.userEmailKey, email);
        return;
      }
      if (data.status === 'not_found') {
        setMessage('That email is not subscribed yet. Thingy can help add you to The Weekly Thing.', 'notice');
        showSecondary('subscribe');
        return;
      }
      if (data.status === 'unconfirmed') {
        setMessage('Please confirm your Weekly Thing subscription first.', 'notice');
        showSecondary('resend');
        return;
      }
      if (data.status === 'subscribed') {
        setMessage('Check your inbox to confirm your subscription, then come back to sign in.', 'success');
        return;
      }
      setMessage(data.message || 'Check your email for the next step.', 'notice');
    } catch (error) {
      setMessage(error.message || 'Sign-in is unavailable right now.', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (emailInput && lastEmail) emailInput.value = lastEmail;
  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      requestMagicLink('check');
    });
  }
  if (resendButton) resendButton.addEventListener('click', () => requestMagicLink('resend_confirmation'));
  if (subscribeButton) subscribeButton.addEventListener('click', () => requestMagicLink('subscribe'));

  if (session.token() && !session.tokenExpired()) {
    setMessage('You are already signed in.', 'success');
  }
  completeMagicLink();
}());
