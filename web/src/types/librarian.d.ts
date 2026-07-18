// Shapes of the Librarian API contract this app consumes. The backend is
// the source of truth (studio-thing: apps/librarian); these types document
// the runtime contract for editors and `npm run typecheck`. Update them
// together with any versioned API change.

interface LibrarianDiscordConnection {
  connected?: boolean;
  username?: string;
  global_name?: string;
  display_name?: string;
  guild_id?: string;
  connected_at?: string;
  last_verified_at?: string;
  user_name?: string;
  globalName?: string;
  displayName?: string;
  connectedAt?: string;
}

// Profile block returned by /auth and /memory responses. The empty arrays
// are a frozen legacy shape kept for older deployed clients.
interface LibrarianProfile {
  email?: string;
  status?: string;
  returning?: boolean;
  first_seen_at?: string;
  last_seen_at?: string;
  preferred_name?: string;
  turn_count?: number;
  entitlements?: string[];
  modes?: Array<{ id: string; label: string; description?: string }>;
  supporting_member?: boolean;
  discord_connection?: LibrarianDiscordConnection | null;
  discordConnection?: LibrarianDiscordConnection | null;
  discord_user?: LibrarianDiscordConnection | null;
  discordUser?: LibrarianDiscordConnection | null;
  current_session_questions?: unknown[];
  recent_prompts?: unknown[];
  prior_session_summaries?: unknown[];
  learned_profile?: unknown[];
  memory_synthesis?: Record<string, never>;
}

interface ThingyAuthData {
  token?: string;
  email?: string;
  status?: string;
  message?: string;
  error?: string;
  profile?: LibrarianProfile;
  entitlements?: string[];
  modes?: ThingyMode[];
}

interface ThingyApiResponse extends ThingyAuthData, DispatchRow {
  contract_version?: string;
  request_id?: string;
  requestId?: string;
  errorMessage?: string;
  conversations?: ThingyConversationSummary[];
  conversation?: ThingyConversationSummary;
  dispatches?: DispatchRow[];
  dispatch?: DispatchRow;
  supporting_member?: boolean;
  items?: DispatchRow[];
  data?: unknown;
  code?: string;
  nodes?: ThingyCuriosityNode[];
  sources?: ThingyArchiveItem[];
  account?: LibrarianAccountOverview;
  reaction?: string;
}

interface ThingyStreamData extends ThingyApiResponse {
  mode?: string;
  delta?: string;
  answer?: string;
  citations?: ThingyCitation[];
  experience?: ThingyExperience;
  commentary?: string;
  detail?: string;
  note?: string;
  kind?: string;
  tool_name?: string;
  toolName?: string;
  brief?: DispatchBrief;
}

// Account overview returned by /memory `get`.
interface LibrarianAccountOverview {
  first_seen_at?: string;
  last_seen_at?: string;
  memory_turn_count?: number;
  conversation_count?: number;
  conversation_turn_count?: number;
  oldest_conversation_at?: string;
  newest_conversation_at?: string;
}

interface DispatchBriefSource {
  id?: string;
  label?: string;
  title?: string;
  url?: string;
  source_kind?: string;
  publish_date?: string;
  why?: string;
}

// Brief published by the dispatch planner conversation (update_dispatch_brief
// tool → `dispatch_brief` SSE event) and passed back on /dispatch `create`.
interface DispatchBrief {
  user_goal?: string;
  working_angle?: string;
  coverage_status?: 'thin' | 'focused' | 'broad' | 'ambiguous';
  selected_sources?: DispatchBriefSource[];
  excluded_scope?: string[];
  generation_instructions?: string;
  preheader_basis?: string;
  status?: 'draft' | 'ready';
}

// Dispatch row from /dispatch list/status/save_draft/create responses.
interface DispatchRow {
  id?: string;
  dispatch_id?: string;
  status?: string;
  topic?: string;
  prompt?: string;
  direction?: string;
  conversation_id?: string;
  clarification_question?: string;
  clarification_answer?: string;
  brief?: DispatchBrief;
  subject?: string;
  title?: string;
  preview?: string;
  error?: string;
  messages?: ThingyDispatchMessage[];
  created_at?: string;
  updated_at?: string;
  template_test?: boolean;
  source_count?: number;
}

// Conversation summary from /conversations `list`.
interface LibrarianConversationSummary {
  id?: string;
  conversation_id?: string;
  title?: string;
  mode?: string;
  scope?: string;
  turn_count?: number;
  created_at?: string;
  updated_at?: string;
  last_message_at?: string;
}

// SSE events streamed by /chat. Event names map to these payloads.
interface ChatSseEventMap {
  meta: { request_id?: string; conversation_id?: string; mode?: string };
  status: { kind?: string; tool_name?: string; message?: string; commentary?: string };
  commentary: { message?: string; delta?: string };
  answer_delta: { delta?: string };
  answer: { answer?: string };
  citations: { citations?: unknown[] };
  experience: { experience?: unknown };
  dispatch_brief: { brief?: DispatchBrief; status?: string; request_id?: string; conversation_id?: string };
  done: { request_id?: string; conversation_id?: string; conversation?: unknown; mode?: string };
  error: { error?: string; request_id?: string };
}
