import { render, type ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import * as session from '../thingy-session.ts';
import { discordConnection, discordConnectionName, hasSupportingAccess } from '../thingy-account.ts';
import { discordSignInUrl, normalizeDiscordCode } from '../thingy-discord-links.ts';
import { errorMessage } from '../thingy-errors.ts';

const CONNECT_COPY = (
  <>
    To connect to the Weekly Thing Supporting Member special Discord, join the server, run <code>/thingy verify</code>{' '}
    in the validation channel, and open the link Thingy gives you.
  </>
);

function DiscordApp() {
  const state = useMemo(() => String(new URLSearchParams(window.location.search).get('state') || '').trim(), []);
  const [copy, setCopy] = useState<ComponentChildren>('Thingy is checking your account.');
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState('');
  const [code, setCode] = useState('');
  const [showSignIn, setShowSignIn] = useState(false);

  useEffect(() => {
    async function initialize() {
      const authReason = !session.token()
        ? 'No Thingy session was found in this browser.'
        : session.tokenExpired()
          ? 'Your Thingy session in this browser is expired.'
          : '';
      if (authReason) {
        setShowSignIn(true);
        setCopy('Sign in to Thingy in this browser to finish connecting Discord.');
        setMessage(`${authReason} The sign-in link will return here with your Discord verification state preserved.`);
        setMessageKind('error');
        return;
      }
      await session.refreshAuth();
      const profile = session.storedProfile();
      if (!hasSupportingAccess(profile)) {
        setCopy(
          <>
            The Weekly Thing Supporting Member special Discord is an exclusive benefit for{' '}
            <a href="https://weekly.thingelstad.com/members/">Supporting Members</a>. Join or manage your membership,
            then sign in again so Thingy can refresh your account.
          </>
        );
        setMessage(
          'If you recently became a Supporting Member, sign out and sign back in so Thingy can refresh your account.'
        );
        setMessageKind('error');
        return;
      }
      if (!state) {
        const connection = discordConnection(profile);
        const name = discordConnectionName(profile);
        setCopy(
          connection
            ? name
              ? `You are connected to Discord as ${name}.`
              : 'You are connected to Discord.'
            : CONNECT_COPY
        );
        setMessage('Thingy will generate a one-time code after you start from Discord.');
        setMessageKind(connection ? 'success' : '');
        return;
      }
      setCopy('Generating a one-time verification code.');
      try {
        const data = await session.postJson(
          '/auth',
          { action: 'discord_link_code', state, email: session.storedEmail() },
          session.authHeaders()
        );
        const nextCode = normalizeDiscordCode(data.code);
        if (!nextCode) throw new Error('Thingy did not return a Discord verification code. Run /thingy verify again.');
        setCode(nextCode);
        setCopy('Copy this code, then use /thingy confirm in Discord and paste it into the code field.');
        setMessage('The code expires soon and only works for the Discord account that started verification.');
        setMessageKind('success');
        if (data.profile) session.updateStoredProfile(data.profile);
      } catch (error) {
        setCopy('Thingy could not create a Discord verification code.');
        setMessage(errorMessage(error, 'Run /thingy verify again in Discord.'));
        setMessageKind('error');
      }
    }
    void initialize();
  }, [state]);

  async function copyCode() {
    if (!code) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(code);
      setMessage('Copied the verification code.');
      setMessageKind('success');
    } catch (_error) {
      setMessage('Copy failed. Select the code and copy it manually.');
      setMessageKind('error');
    }
  }

  return (
    <div class="thingy-auth-page thingy-discord-page">
      <section class="thingy-auth-card thingy-discord-card" aria-labelledby="thingy-discord-title">
        <a class="thingy-auth-mark" href="/" aria-label="Thingy home">
          <img src="/img/thingy.png" alt="" width="1022" height="1022" />
        </a>
        <p class="thingy-auth-kicker">Thingy Discord</p>
        <h1 id="thingy-discord-title">Connect Discord</h1>
        <p>{copy}</p>
        <p class="thingy-discord-benefit">
          This is an <strong>EXCLUSIVE benefit for Supporting Members</strong>.{' '}
          <a href="https://weekly.thingelstad.com/members/">Become or manage your Supporting Membership</a>.
        </p>
        <div class="thingy-discord-signin" hidden={!showSignIn}>
          <a href={discordSignInUrl(state)}>Sign In to Continue</a>
        </div>
        <div class="thingy-discord-code" hidden={!code}>
          <span>Verification code</span>
          <strong>{code}</strong>
          <button type="button" onClick={() => void copyCode()}>
            Copy Code
          </button>
        </div>
        <p class="thingy-signin-message" data-kind={messageKind} aria-live="polite">
          {message}
        </p>
        <div class="thingy-discord-actions">
          <a class="thingy-discord-button secondary" href="/chat/">
            Back to Chat
          </a>
          <a class="thingy-discord-button primary" href="https://discord.gg/MaCyhPv7Y4" target="_blank" rel="noopener">
            Open Discord
          </a>
        </div>
      </section>
    </div>
  );
}

function mountDiscordApp(host: HTMLElement | null) {
  if (host) render(<DiscordApp />, host);
}

export { mountDiscordApp };
