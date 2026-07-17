// @ts-check
// Cross-surface UI signals: the notice (toast) surface, the rail state
// (collapsed / mobile open), and the account-menu identity that both /chat/
// and /dispatch/ render in the same way.

import { signal } from '@preact/signals';

// --- Rail state -------------------------------------------------------------

// The desktop rail can be collapsed (icons only) via the rail header button;
// the mobile chatbar opens it as a drawer via the chevron toggle.
const railCollapsed = signal(false);
const mobileRailOpen = signal(false);

// --- Account identity (cross-surface) ---------------------------------------

// True when a Thingy session token is held in this browser. Written by the
// chat and dispatch bootstraps when they persist or clear the token, and by
// the chat storage listener that catches cross-tab sign-outs.
const signedIn = signal(false);

// Email currently associated with this browser's session. Used as the rail
// account display string and as the avatar's initial source.
const displayEmail = signal('');

// Stored profile object (status, entitlements, discord_connection, etc.).
const displayProfile = signal<LibrarianProfile>({});

// Preferred name the user has set; defaults to ''. Mirrored from the stored
// profile by the bootstrap.
const displayPreferredName = signal('');

// True when the account menu drawer is open.
const accountMenuOpen = signal(false);

// Save status under the preferred-name form; reset between opens.
const accountNameStatus = signal('');

// --- Notice (toast) ---------------------------------------------------------

// `text` is the visible message; `nonce` advances on every emission so the
// consumer can dismiss-and-rearm correctly even when the same string is
// shown twice in a row.
const noticeText = signal('');
const noticeNonce = signal(0);

function showNotice(text: unknown) {
  noticeText.value = String(text || '');
  noticeNonce.value = noticeNonce.value + 1;
}

function clearNotice() {
  noticeText.value = '';
}

export {
  accountMenuOpen,
  accountNameStatus,
  clearNotice,
  displayEmail,
  displayPreferredName,
  displayProfile,
  mobileRailOpen,
  noticeNonce,
  noticeText,
  railCollapsed,
  showNotice,
  signedIn
};
