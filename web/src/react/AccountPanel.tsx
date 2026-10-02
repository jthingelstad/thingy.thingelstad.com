import { Fragment, useEffect, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { buildId } from '../shared/thingy-config.ts';
import { hasSupportingAccess, savePreferredName } from '../shared/thingy-account.ts';
import { errorMessage } from '../shared/thingy-errors.ts';
import {
  formatActiveSpan,
  formatCardIssued,
  formatChatModel,
  formatDailyQuota,
  formatProfileActivity,
  formatProfileDate,
  usageMeters
} from '../shared/thingy-profile.ts';
import { Icon } from './components/Icon.tsx';
import { DialogHeader, SHEET_CONTENT, SHEET_OVERLAY, SHEET_SAFE_BOTTOM, SheetGrab } from './components/Sheet.tsx';
import { PHONE_QUERY, useMediaQuery } from './hooks/useMediaQuery.ts';
import { McpConnectionsSection, McpLogDialog } from './McpConnections.tsx';
import { confirmDialog } from '../shared/stores/dialog-store.ts';
import * as session from '../shared/thingy-session.ts';

// The account trigger, its menu, and the Profile dialog (Felt &
// Tangerine, phase 3). Same /memory contract and the same nine rows -
// including the entitlement-routed "AI model" row; the sentences come from
// shared/thingy-profile.ts, where node:test pins them.
//
// Desktop: the menu is a popover over the rail and Profile a centred
// modal. Phone (below md): the menu is a bottom sheet and so is Profile.

const TIER_SUPPORTING = 'Supporting Member';
const TIER_READER = 'Weekly Thing reader';

/** The mascot's screen with the reader's initial in mint (library card). */
function ScreenAvatar({ initial, className = '' }: { initial: string; className?: string }) {
  return (
    <span
      className={`thingy-card-avatar flex shrink-0 -rotate-3 items-center justify-center rounded-[26px] border-[5px] border-bezel bg-screen shadow-[0_0_0_3px_var(--thingy-ink)] ${className}`}
      aria-hidden="true"
    >
      <span className="thingy-display text-[44px] leading-none text-mint max-sm:text-[34px]">{initial}</span>
      <span className="mb-[20px] ml-1 h-[5px] w-[14px] self-end rounded-[2px] bg-mint max-sm:mb-[15px]" />
    </span>
  );
}

function TierBadge({ supporting }: { supporting: boolean }) {
  if (supporting) {
    return (
      <span className="thingy-tier-stamp thingy-display mt-3 ml-1.5 inline-flex -rotate-4 items-center gap-2 rounded-[10px] border-[2.5px] border-weekly-deep bg-weekly-tint py-1.5 pr-3.5 pl-2.5 text-[17px] text-weekly-deep shadow-[0_0_0_3px_var(--thingy-paper),0_0_0_5px_var(--thingy-brass)] [&_svg]:size-[18px] [&_svg]:fill-brass [&_svg]:stroke-weekly-deep [&_svg]:stroke-[1.6]">
        <Icon name="star" />
        {TIER_SUPPORTING}
      </span>
    );
  }
  return (
    <span className="thingy-tier-tag mt-2.5 inline-flex items-center gap-2 rounded-full border-2 border-ink bg-toy py-1 pr-3.5 pl-1 text-[14px] font-bold text-ink">
      <span className="thingy-w-disc size-6 bg-weekly text-white" aria-hidden="true" />
      {TIER_READER}
    </span>
  );
}

function ProfileModal({
  open,
  onClose,
  onProfileDeleted,
  profile,
  email,
  preferredName,
  supporting,
  returnFocusTo
}: {
  open: boolean;
  onClose: () => void;
  onProfileDeleted: () => void;
  profile: LibrarianProfile;
  email: string;
  preferredName: string;
  supporting: boolean;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}) {
  const [viewProfile, setViewProfile] = useState<LibrarianProfile>(profile || {});
  const [accountOverview, setAccountOverview] = useState<LibrarianAccountOverview>({});
  const [busyAction, setBusyAction] = useState('');
  const [profileError, setProfileError] = useState('');
  // Non-null while the MCP request log is open over the profile.
  const [logConnections, setLogConnections] = useState<LibrarianMcpConnection[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setViewProfile(profile || {});
    setAccountOverview({});
    setProfileError('');
    setLogConnections(null);
    void (async () => {
      setBusyAction('load');
      try {
        const data = await session.postJson('/memory', { action: 'get' }, session.authHeaders());
        if (data.profile) {
          setViewProfile(session.mergeProfile(data, email));
          setAccountOverview(data.account || {});
        }
      } catch (error) {
        setProfileError(errorMessage(error, 'Thingy could not load this profile right now.'));
      } finally {
        setBusyAction('');
      }
    })();
    // Reset-and-reload only on open/close transitions.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const viewPreferredName = String(preferredName || viewProfile.preferred_name || '').trim();
  const firstSeen = accountOverview.first_seen_at || viewProfile.first_seen_at;
  const lastActivity = accountOverview.last_seen_at || viewProfile.last_seen_at;
  const rows = (
    [
      ['Name', viewPreferredName || 'Not set'],
      email ? ['Email', email] : null,
      ['Access', supporting ? TIER_SUPPORTING : TIER_READER],
      formatChatModel(accountOverview, supporting) ? ['AI model', formatChatModel(accountOverview, supporting)] : null,
      ['First seen', formatProfileDate(firstSeen) || 'Not recorded'],
      ['Last activity', formatProfileDate(lastActivity) || 'Not recorded'],
      ['Active span', formatActiveSpan(firstSeen, lastActivity)],
      ['Thingy activity', formatProfileActivity(accountOverview, viewProfile)],
      formatDailyQuota(accountOverview) ? ["Today's usage", formatDailyQuota(accountOverview)] : null
    ] as Array<[string, string] | null>
  ).filter((row): row is [string, string] => row !== null);

  async function handleDeleteProfile() {
    const confirmed = await confirmDialog({
      title: 'Delete your Thingy profile?',
      body: 'Conversations, activity, and preferences are removed for good. Your Weekly Thing subscription is unaffected.',
      confirmLabel: 'Delete profile',
      danger: true,
      face: 'oops'
    });
    if (!confirmed) return;
    setBusyAction('delete_profile');
    setProfileError('');
    try {
      await session.postJson('/memory', { action: 'delete_profile' }, session.authHeaders());
      onProfileDeleted();
    } catch (error) {
      setProfileError(errorMessage(error, 'Thingy could not delete this profile right now.'));
    } finally {
      setBusyAction('');
    }
  }

  const cardName = viewPreferredName || email || 'Thingy reader';
  const cardInitial = (viewPreferredName || email || 'T')[0].toUpperCase();
  const cardIssued = formatCardIssued(firstSeen);
  const meters = usageMeters(accountOverview);

  return (
    <Dialog.Root open onOpenChange={(next) => (next ? undefined : onClose())}>
      <Dialog.Portal>
        <Dialog.Overlay className={SHEET_OVERLAY}>
          <Dialog.Content
            className={`thingy-profile ${SHEET_CONTENT} max-h-[min(900px,calc(100vh-40px))] w-[min(47.5rem,100%)] overflow-y-auto px-8 pt-6 pb-7 max-md:px-4 ${SHEET_SAFE_BOTTOM}`}
            aria-describedby={undefined}
            onCloseAutoFocus={(event) => {
              // The menu item that opened Profile is gone; return to the
              // account button instead.
              event.preventDefault();
              returnFocusTo.current?.focus();
            }}
          >
            <SheetGrab />
            <DialogHeader
              title="Profile"
              titleClassName="text-[32px] leading-[1.05] max-md:text-[26px]"
              subtitle="Account details and Thingy activity."
              mark={{ icon: 'users-round' }}
              closeLabel="Close Profile"
            />
            <section className="min-h-5 pt-2 text-[14px] text-meta" aria-live="polite">
              <span>{busyAction === 'load' ? 'Loading profile...' : ''}</span>
              {profileError ? <small className="text-[14px] text-danger">{profileError}</small> : null}
            </section>
            <div className="thingy-memory-panel grid gap-5 pt-1">
              <div
                role="group"
                aria-label="Library card"
                className="thingy-library-card overflow-hidden rounded-[20px] border-2 border-ink bg-paper shadow-[0_6px_0_var(--thingy-ink)]"
              >
                <div className="flex h-10 items-center justify-between border-b-2 border-ink bg-tangerine px-5">
                  <span className="font-mono text-[12px] font-semibold tracking-[0.16em] text-on-tangerine uppercase">
                    Thingy library card
                  </span>
                  <span className="size-3.5 rounded-full border-2 border-ink bg-bg" aria-hidden="true" />
                </div>
                <div className="flex items-center gap-6 px-6 pt-4 pb-[18px] max-sm:flex-wrap max-sm:gap-4 max-sm:px-4">
                  <ScreenAvatar initial={cardInitial} className="h-[84px] w-[104px] max-sm:h-[64px] max-sm:w-[80px]" />
                  <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                    <span className="thingy-display max-w-full truncate text-[40px] leading-none tracking-[-0.025em] max-sm:text-[30px]">
                      {cardName}
                    </span>
                    {email && email !== cardName ? (
                      <span className="max-w-full truncate font-mono text-[14px] text-meta">{email}</span>
                    ) : null}
                    <TierBadge supporting={supporting} />
                  </div>
                  {cardIssued ? (
                    <div className="thingy-card-stamp flex w-[176px] shrink-0 rotate-[1.5deg] flex-col gap-1 rounded-xl border-2 border-ink px-3.5 pt-2.5 pb-3 max-sm:w-full max-sm:rotate-0 max-sm:bg-none max-sm:flex-row max-sm:flex-wrap max-sm:items-baseline max-sm:gap-x-3">
                      <span className="font-mono text-[11px] font-semibold tracking-[0.14em] text-meta uppercase">
                        Card issued
                      </span>
                      <span className="thingy-display text-[22px] leading-[1.1]">{cardIssued}</span>
                      <span className="font-mono text-[11.5px] text-meta">First seen</span>
                    </div>
                  ) : null}
                </div>
              </div>
              <dl className="thingy-memory-dl thingy-profile-dl">
                {rows.map(([label, value]) => (
                  <Fragment key={label}>
                    <dt>{label}</dt>
                    <dd>
                      {value}
                      {label === "Today's usage" && meters.length ? <UsageMeters meters={meters} /> : null}
                    </dd>
                  </Fragment>
                ))}
              </dl>
              <McpConnectionsSection disabled={Boolean(busyAction)} onOpenLog={setLogConnections} />
              <section
                className="thingy-danger-zone flex flex-col items-start gap-3 rounded-[18px] border-2 border-danger bg-danger-tint px-5 pt-[18px] pb-5"
                aria-label="Delete Thingy Profile"
              >
                <div className="grid gap-1">
                  <h3 className="text-[18px] font-extrabold text-danger">Delete Thingy Profile</h3>
                  <p className="text-[15px] leading-[1.45] text-ink">
                    This deletes your Thingy profile and conversations. It does not unsubscribe you from Weekly Thing.
                  </p>
                </div>
                <button
                  type="button"
                  className="thingy-btn thingy-btn-danger min-h-[46px] px-5 text-[15px]"
                  disabled={Boolean(busyAction)}
                  onClick={() => void handleDeleteProfile()}
                >
                  {busyAction === 'delete_profile' ? 'Deleting...' : 'Delete Thingy Profile'}
                </button>
              </section>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
      {logConnections ? <McpLogDialog connections={logConnections} onClose={() => setLogConnections(null)} /> : null}
    </Dialog.Root>
  );
}

/** The meters under Today's usage: decoration for the eye; the sentence
 *  above them is what a screen reader hears. */
function UsageMeters({ meters }: { meters: ReturnType<typeof usageMeters> }) {
  return (
    <div className="thingy-usage-meters mt-2.5 grid grid-cols-2 gap-[18px] max-sm:grid-cols-1" aria-hidden="true">
      {meters.map((meter) => (
        <div key={meter.kind} className="grid gap-[5px]">
          <div className="flex justify-between font-mono text-[11px] font-semibold tracking-[0.08em] text-meta uppercase">
            <span>{meter.label}</span>
            <span>{meter.value}</span>
          </div>
          <div className={`thingy-meter${meter.kind === 'mcp' ? ' thingy-meter-mcp' : ''}`}>
            <span style={{ width: `${meter.percent}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// The menu's contents, shared by the desktop popover and the phone sheet:
// the name tag (band, label, field and Save), Show Profile, Logout in
// danger red, and the build string (.rail-menu-build is a smoke hook).
function AccountMenuBody({
  preferredName,
  nameStatus,
  onSubmitName,
  onShowProfile,
  onLogout,
  phone
}: {
  preferredName: string;
  nameStatus: string;
  onSubmitName: (event: FormEvent<HTMLFormElement>) => void;
  onShowProfile: () => void;
  onLogout: () => void;
  phone: boolean;
}) {
  return (
    <>
      <div
        className={
          phone
            ? 'thingy-account-name overflow-hidden rounded-[18px] border-2 border-ink bg-paper'
            : 'thingy-account-name'
        }
      >
        <div
          className="border-b-2 border-ink bg-tangerine px-4 py-[7px] font-mono text-[11px] font-semibold tracking-[0.16em] text-on-tangerine uppercase"
          aria-hidden="true"
        >
          Hello, my name is
        </div>
        <form className="grid gap-1.5 px-3.5 pt-3 pb-1.5" onSubmit={onSubmitName}>
          <label htmlFor="thingy-preferred-name" className="thingy-field-label mb-0">
            Name
          </label>
          <div className="flex gap-2">
            <input
              id="thingy-preferred-name"
              className="thingy-input min-w-0 flex-1"
              name="preferred_name"
              type="text"
              maxLength={80}
              autoComplete="name"
              placeholder="What should Thingy call you?"
              defaultValue={preferredName}
            />
            <button type="submit" className="thingy-btn thingy-btn-primary shrink-0 px-[18px]">
              Save
            </button>
          </div>
          <p className="min-h-5 text-[13px] text-meta" aria-live="polite">
            {nameStatus}
          </p>
        </form>
      </div>
      <div className={`grid gap-1 ${phone ? 'pt-3' : 'px-2 pb-2.5'}`}>
        <button
          type="button"
          className="flex min-h-14 items-center gap-3 rounded-[14px] px-2 text-left transition-colors hover:bg-toy"
          onClick={onShowProfile}
        >
          <span className="thingy-icon-tile size-10 rounded-xl [&_svg]:size-[19px]" aria-hidden="true">
            <Icon name="users-round" />
          </span>
          <span className="grid min-w-0 flex-1 gap-px">
            <strong className="text-[15px] font-extrabold text-ink">Show Profile</strong>
            <small className="text-[13px] text-ink">Account details and activity</small>
          </span>
          {phone ? (
            <span className="text-meta [&_svg]:size-5" aria-hidden="true">
              <Icon name="chevron-right" />
            </span>
          ) : null}
        </button>
        <div className="mx-1 my-1 border-t-2 border-dashed border-rule" role="separator" />
        <button
          type="button"
          className="flex min-h-11 items-center gap-2.5 rounded-xl px-2.5 text-left text-[15px] font-extrabold text-danger transition-colors hover:bg-danger-tint [&_svg]:size-[18px]"
          onClick={onLogout}
        >
          <Icon name="log-out" />
          Logout
        </button>
        <p className="rail-menu-build px-2.5 pt-0.5 font-mono text-[11.5px] text-meta" title="Thingy build">
          Build {buildId()}
        </p>
      </div>
    </>
  );
}

export function AccountPanel() {
  const [email] = useState(() => session.storedEmail());
  const [profile, setProfile] = useState<LibrarianProfile>(() => session.storedProfile());
  const [preferredName, setPreferredName] = useState(() => String(session.storedProfile().preferred_name || '').trim());
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [nameStatus, setNameStatus] = useState('');
  const phone = useMediaQuery(PHONE_QUERY);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const supporting = hasSupportingAccess(profile);
  const display = email || preferredName;
  const initial = (email || preferredName || 'T')[0].toUpperCase();
  const tier = supporting ? TIER_SUPPORTING : TIER_READER;

  async function handleNameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = (event.currentTarget.elements.namedItem('preferred_name') as HTMLInputElement | null)?.value || '';
    setNameStatus('Saving...');
    try {
      const { data, savedName } = await savePreferredName(session, input, (value) => String(value || '').trim());
      setPreferredName(savedName);
      if (data.profile) setProfile(session.mergeProfile(data, email));
      setNameStatus('Saved.');
    } catch (error) {
      setNameStatus(errorMessage(error, 'Could not save that right now.'));
    }
  }

  function handleLogout() {
    setOpen(false);
    setProfileOpen(false);
    session.clearAuth();
    window.location.href = session.signInUrl('/chat/');
  }

  const body = (
    <AccountMenuBody
      phone={phone}
      preferredName={preferredName}
      nameStatus={nameStatus}
      onSubmitName={(event) => void handleNameSubmit(event)}
      onShowProfile={() => {
        setProfileOpen(true);
        setOpen(false);
      }}
      onLogout={handleLogout}
    />
  );

  const avatar = (size: string): ReactNode => (
    <span
      className={`grid ${size} shrink-0 place-items-center rounded-full border-2 border-rail-deep bg-mint font-sans text-base font-extrabold text-ink`}
      aria-hidden="true"
    >
      {initial}
    </span>
  );

  const trigger = (
    <button
      ref={triggerRef}
      className="rail-account-btn flex min-h-14 w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-rail-raised"
      type="button"
      title="Account"
    >
      {avatar('size-[38px]')}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-sans text-[15px] font-bold text-bg">{display || 'Signed in'}</span>
        <span className="block truncate font-mono text-[11px] tracking-[0.04em] text-rail-field">{tier}</span>
      </span>
      <span className="text-rail-icon [&_svg]:size-4" aria-hidden="true">
        <Icon name="chevron-down" />
      </span>
    </button>
  );

  return (
    <div className="rail-account thingy-aui-account">
      {phone ? (
        <Dialog.Root open={open} onOpenChange={setOpen}>
          <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className={SHEET_OVERLAY}>
              <Dialog.Content
                className={`thingy-account-sheet ${SHEET_CONTENT} overflow-y-auto px-4 pt-4 pb-4 ${SHEET_SAFE_BOTTOM}`}
                aria-describedby={undefined}
              >
                <SheetGrab />
                <div className="flex items-center gap-3 pb-3.5">
                  {avatar('size-11 border-ink text-[18px]')}
                  <div className="min-w-0 flex-1">
                    <Dialog.Title asChild>
                      <h2 className="thingy-modal-title">Account</h2>
                    </Dialog.Title>
                    <p className="truncate font-mono text-[12.5px] text-meta">
                      {display ? `${display} · ${tier}` : tier}
                    </p>
                  </div>
                  <Dialog.Close asChild>
                    <button type="button" className="thingy-icon-btn -mr-1 self-start" aria-label="Close">
                      <Icon name="x" />
                    </button>
                  </Dialog.Close>
                </div>
                {body}
              </Dialog.Content>
            </Dialog.Overlay>
          </Dialog.Portal>
        </Dialog.Root>
      ) : (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>{trigger}</Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="thingy-account-menu z-50 w-80 overflow-hidden rounded-[20px] border-2 border-ink bg-paper font-sans text-ink shadow-[6px_6px_0_var(--thingy-rail-deep)]"
              aria-label="Account"
              side="top"
              align="start"
              sideOffset={10}
            >
              {body}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onProfileDeleted={handleLogout}
        profile={profile}
        email={email}
        preferredName={preferredName}
        supporting={supporting}
        returnFocusTo={triggerRef}
      />
    </div>
  );
}
