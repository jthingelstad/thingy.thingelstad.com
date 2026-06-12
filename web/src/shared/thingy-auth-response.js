// @ts-check
function handleAuthResponse(data = {}, options = {}) {
  const setMessage = typeof options.setMessage === 'function' ? options.setMessage : () => {};
  const showAction = typeof options.showAction === 'function' ? options.showAction : () => {};
  const hideActions = typeof options.hideActions === 'function' ? options.hideActions : () => {};
  const track = typeof options.track === 'function' ? options.track : () => {};

  if (data.token) {
    if (typeof options.onToken === 'function') options.onToken(data);
    setMessage('');
    track('librarian.auth_success', data.status || 'active');
    return 'token';
  }
  if (data.status === 'not_found') {
    setMessage(data.message || 'That email is not subscribed. Would you like to be added?');
    showAction('subscribe');
    track('librarian.auth_not_found');
    return data.status;
  }
  if (data.status === 'unconfirmed') {
    setMessage(data.message || 'Please confirm your email before using Thingy.');
    showAction('resend_confirmation');
    track('librarian.auth_unconfirmed');
    return data.status;
  }
  if (data.status === 'subscribed') {
    setMessage(data.message || 'Check your inbox to confirm your subscription before using Thingy.');
    hideActions();
    track('librarian.auth_subscribe_success');
    return data.status;
  }
  if (data.status === 'reminder_sent') {
    setMessage(data.message || 'Confirmation email sent. Check your inbox.');
    hideActions();
    track('librarian.auth_reminder_success');
    return data.status;
  }
  if (data.status === 'magic_link_sent') {
    setMessage(data.message || 'Check your email for a sign-in link to Thingy.');
    hideActions();
    track('librarian.auth_magic_link_sent');
    return data.status;
  }
  if (data.status === 'magic_link_invalid') {
    setMessage(
      data.error || data.message || 'That sign-in link is invalid or expired. Enter your email to get a fresh link.'
    );
    hideActions();
    track('librarian.auth_magic_link_invalid');
    return data.status;
  }
  setMessage(data.message || 'I could not verify active subscriber access for that email.');
  hideActions();
  track('librarian.auth_inactive');
  return data.status || 'inactive';
}

export { handleAuthResponse };
