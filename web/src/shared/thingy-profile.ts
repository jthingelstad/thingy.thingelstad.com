// Profile dialog formatting (the account menu's "Show Profile"). Pure
// functions over the /memory `get` response so node:test can pin the exact
// sentences the dialog shows; the React side (AccountPanel.tsx) only lays
// them out.

// Counts use the thousands separator ("1,000"), Jamie 2026-10-01. Pinned to
// en-US so the sentence reads the same in every browser locale.
function formatCount(value: number) {
  return value.toLocaleString('en-US');
}

export function formatProfileDate(value: unknown) {
  const text = String(value || '').trim();
  if (!text) return '';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toLocaleString();
}

/** The library card's "Card issued" stamp: First seen as "Sep 2, 2026". */
export function formatCardIssued(value: unknown) {
  const date = new Date(String(value || '').trim());
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatProfileCount(value: unknown, label: string) {
  const count = Number(value || 0);
  return `${formatCount(count)} ${label}${count === 1 ? '' : 's'}`;
}

function profileNumber(value: unknown) {
  const count = Number(value || 0);
  return Number.isFinite(count) ? count : 0;
}

function formatDurationParts(milliseconds: number) {
  const minutes = Math.max(0, Math.floor(milliseconds / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainingMinutes = minutes % 60;
  const parts: string[] = [];
  if (days) parts.push(`${formatCount(days)} day${days === 1 ? '' : 's'}`);
  if (hours && parts.length < 2) parts.push(`${hours} hour${hours === 1 ? '' : 's'}`);
  if (!parts.length && remainingMinutes) parts.push(`${remainingMinutes} minute${remainingMinutes === 1 ? '' : 's'}`);
  return parts.length ? parts.join(', ') : 'Less than a minute';
}

export function formatActiveSpan(startValue: unknown, endValue: unknown) {
  const start = new Date(String(startValue || '').trim());
  const end = new Date(String(endValue || '').trim());
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 'Just getting started';
  return formatDurationParts(Math.max(0, end.getTime() - start.getTime()));
}

export function formatProfileActivity(accountOverview: LibrarianAccountOverview = {}, profile: LibrarianProfile = {}) {
  const totalTurns = profileNumber(accountOverview.memory_turn_count ?? profile.turn_count);
  const conversationCount = profileNumber(accountOverview.conversation_count);
  const conversationTurns = profileNumber(accountOverview.conversation_turn_count);
  const first = totalTurns
    ? `You and Thingy have traded ${formatProfileCount(totalTurns, 'turn')}.`
    : 'No turns together yet.';
  const second = conversationCount
    ? `${formatProfileCount(conversationCount, 'saved conversation')} holding ${formatProfileCount(conversationTurns, 'turn')}.`
    : 'No saved conversations yet.';
  return `${first} ${second}`;
}

function formatTokensUsed(count: number) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M tokens`;
  if (count >= 10_000) return `${Math.round(count / 1000)}k tokens`;
  if (count >= 1_000) return `${(count / 1000).toFixed(1)}k tokens`;
  return `${count} tokens`;
}

export function formatDailyQuota(accountOverview: LibrarianAccountOverview = {}) {
  const quota = accountOverview.quota;
  if (!quota) return '';
  // Informational usage (contract 4.9) - counted for every account
  // including the owner; the enforcement quota stays turn-based.
  const turns = Number(quota.turns_today || 0);
  const tokens = Number(quota.tokens_today || 0);
  if (quota.unlimited) {
    if (!turns) return 'Quiet so far today - and no limits on the owner account.';
    return `${formatCount(turns)} chat turn${turns === 1 ? '' : 's'} · ${formatTokensUsed(tokens)} today. No limits on the owner account.`;
  }
  const used = Number(quota.chat_used || 0);
  const max = Number(quota.chat_max || 0);
  if (!max) return '';
  const parts = [`${formatCount(used)} of ${formatCount(max)} chat turns`];
  if (tokens > 0) parts.push(formatTokensUsed(tokens));
  const mcpUsed = Number(quota.mcp_used || 0);
  const mcpMax = Number(quota.mcp_max || 0);
  if (mcpUsed > 0 && mcpMax > 0) parts.push(`${formatCount(mcpUsed)} of ${formatCount(mcpMax)} MCP tool calls`);
  return `${parts.join(' · ')} used today. Resets at midnight UTC.`;
}

export interface UsageMeter {
  label: string;
  /** "18 / 1,000" */
  value: string;
  /** Fill, 0-100. */
  percent: number;
  kind: 'chat' | 'mcp';
}

/**
 * The meters under Today's usage. They repeat the sentence for the eye
 * (the dialog marks them aria-hidden), so they show exactly what the
 * sentence says and nothing more: no meters for the owner's unlimited
 * account, and the MCP meter only when the sentence names MCP calls.
 */
export function usageMeters(accountOverview: LibrarianAccountOverview = {}): UsageMeter[] {
  const quota = accountOverview.quota;
  if (!quota || quota.unlimited) return [];
  const meters: UsageMeter[] = [];
  const meter = (kind: UsageMeter['kind'], label: string, used: number, max: number) => ({
    kind,
    label,
    value: `${formatCount(used)} / ${formatCount(max)}`,
    percent: Math.round(Math.max(0, Math.min(100, (used / max) * 100)) * 10) / 10
  });
  const used = Number(quota.chat_used || 0);
  const max = Number(quota.chat_max || 0);
  if (!max) return [];
  meters.push(meter('chat', 'Chat turns', used, max));
  const mcpUsed = Number(quota.mcp_used || 0);
  const mcpMax = Number(quota.mcp_max || 0);
  if (mcpUsed > 0 && mcpMax > 0) meters.push(meter('mcp', 'MCP tool calls', mcpUsed, mcpMax));
  return meters;
}

export function formatChatModel(accountOverview: LibrarianAccountOverview = {}, supporting = false) {
  const model = accountOverview.chat_model;
  const label = String(model?.label || '').trim();
  if (!label) return '';
  if (model?.premium && supporting) return `${label} — premium model, included with your membership`;
  if (model?.premium) return `${label} — premium model`;
  return label;
}
