import { z } from 'zod';

const modeSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    description: z.string().optional()
  })
  .passthrough();

const discordConnectionSchema = z
  .object({
    connected: z.boolean().optional(),
    username: z.string().optional(),
    global_name: z.string().optional(),
    display_name: z.string().optional(),
    guild_id: z.string().optional(),
    connected_at: z.string().optional(),
    last_verified_at: z.string().optional(),
    user_name: z.string().optional(),
    globalName: z.string().optional(),
    displayName: z.string().optional(),
    connectedAt: z.string().optional()
  })
  .passthrough();

const profileSchema = z
  .object({
    email: z.string().optional(),
    status: z.string().optional(),
    returning: z.boolean().optional(),
    first_seen_at: z.string().optional(),
    last_seen_at: z.string().optional(),
    preferred_name: z.string().optional(),
    turn_count: z.number().optional(),
    entitlements: z.array(z.string()).optional(),
    modes: z.array(modeSchema).optional(),
    supporting_member: z.boolean().optional(),
    discord_connection: discordConnectionSchema.nullable().optional(),
    discordConnection: discordConnectionSchema.nullable().optional(),
    discord_user: discordConnectionSchema.nullable().optional(),
    discordUser: discordConnectionSchema.nullable().optional(),
    current_session_questions: z.array(z.unknown()).optional(),
    recent_prompts: z.array(z.unknown()).optional(),
    prior_session_summaries: z.array(z.unknown()).optional(),
    learned_profile: z.array(z.unknown()).optional(),
    memory_synthesis: z.record(z.string(), z.never()).optional()
  })
  .passthrough();

const conversationSchema = z
  .object({
    id: z.string().optional(),
    conversation_id: z.string().optional(),
    title: z.string().optional(),
    mode: z.string().optional(),
    scope: z.string().optional(),
    turn_count: z.number().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    last_message_at: z.string().optional(),
    preview: z.string().optional(),
    local: z.boolean().optional(),
    draft: z.boolean().optional()
  })
  .passthrough();

const conversationMessageSchema = z
  .object({
    role: z.string().optional(),
    content: z.string().optional(),
    scope: z.string().optional(),
    artifact: z.unknown().optional(),
    tool_names: z.array(z.string()).optional(),
    toolNames: z.array(z.string()).optional(),
    request_id: z.string().optional(),
    requestId: z.string().optional(),
    citations: z.array(z.unknown()).optional()
  })
  .passthrough();

const dispatchBriefSourceSchema = z
  .object({
    id: z.string().optional(),
    label: z.string().optional(),
    title: z.string().optional(),
    url: z.string().optional(),
    source_kind: z.string().optional(),
    publish_date: z.string().optional(),
    why: z.string().optional()
  })
  .passthrough();

const dispatchBriefSchema = z
  .object({
    user_goal: z.string().optional(),
    working_angle: z.string().optional(),
    coverage_status: z.enum(['thin', 'focused', 'broad', 'ambiguous']).optional(),
    selected_sources: z.array(dispatchBriefSourceSchema).optional(),
    excluded_scope: z.array(z.string()).optional(),
    generation_instructions: z.string().optional(),
    preheader_basis: z.string().optional(),
    status: z.enum(['draft', 'ready']).optional()
  })
  .passthrough();

const dispatchMessageSchema = z
  .object({
    id: z.string().optional(),
    baseId: z.string().optional(),
    scope: z.string().optional(),
    role: z.enum(['user', 'assistant', 'system']).optional(),
    text: z.string().optional(),
    time: z.string().optional(),
    kind: z.string().optional(),
    status: z.string().optional(),
    startedAt: z.number().optional(),
    completedAt: z.union([z.number(), z.string()]).optional()
  })
  .passthrough();

const dispatchRowSchema = z
  .object({
    id: z.string().optional(),
    dispatch_id: z.string().optional(),
    status: z.string().optional(),
    topic: z.string().optional(),
    prompt: z.string().optional(),
    direction: z.string().optional(),
    conversation_id: z.string().optional(),
    clarification_question: z.string().optional(),
    clarification_answer: z.string().optional(),
    brief: dispatchBriefSchema.optional(),
    subject: z.string().optional(),
    title: z.string().optional(),
    preview: z.string().optional(),
    error: z.string().optional(),
    messages: z.array(dispatchMessageSchema).optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    template_test: z.boolean().optional(),
    source_count: z.number().optional()
  })
  .passthrough();

const archiveItemSchema = z
  .object({
    url: z.string().optional(),
    title: z.string().optional(),
    subject: z.string().optional(),
    label: z.string().optional(),
    publish_date: z.string().optional(),
    reason: z.string().optional(),
    source_kind: z.string().optional()
  })
  .passthrough();

const citationSchema = z
  .object({
    // Non-Weekly sources deliberately carry null because they have no issue
    // number; omission and null are both part of the live Librarian shape.
    issue_number: z.union([z.string(), z.number()]).nullable().optional(),
    url: z.string().optional(),
    subject: z.string().optional(),
    publish_date: z.string().optional(),
    section: z.string().optional()
  })
  .passthrough();

const experienceSchema = z
  .object({
    kind: z.string().optional(),
    title: z.string().optional(),
    intro: z.string().optional(),
    prompt: z.string().optional(),
    items: z.array(archiveItemSchema).optional()
  })
  .passthrough();

const curiosityNodeSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    kind: z.string().optional(),
    prompt: z.string().optional(),
    why: z.string().optional(),
    weight: z.number().optional()
  })
  .passthrough();

const accountOverviewSchema = z
  .object({
    first_seen_at: z.string().optional(),
    last_seen_at: z.string().optional(),
    memory_turn_count: z.number().optional(),
    conversation_count: z.number().optional(),
    conversation_turn_count: z.number().optional(),
    oldest_conversation_at: z.string().optional(),
    newest_conversation_at: z.string().optional()
  })
  .passthrough();

const apiResponseSchema = dispatchRowSchema
  .extend({
    token: z.string().optional(),
    email: z.string().optional(),
    status: z.string().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
    errorMessage: z.string().optional(),
    profile: profileSchema.optional(),
    entitlements: z.array(z.string()).optional(),
    modes: z.array(modeSchema).optional(),
    request_id: z.string().optional(),
    requestId: z.string().optional(),
    conversations: z.array(conversationSchema).optional(),
    conversation: conversationSchema.optional(),
    dispatches: z.array(dispatchRowSchema).optional(),
    dispatch: dispatchRowSchema.optional(),
    supporting_member: z.boolean().optional(),
    items: z.array(dispatchRowSchema).optional(),
    data: z.unknown().optional(),
    code: z.string().optional(),
    nodes: z.array(curiosityNodeSchema).optional(),
    sources: z.array(archiveItemSchema).optional(),
    account: accountOverviewSchema.optional(),
    reaction: z.string().optional()
  })
  .passthrough();

// The API is one Lambda surface, but callers still cross distinct versioned
// endpoint contracts. These schemas deliberately share additive base fields
// while reasserting each endpoint's owned response collections/records.
const endpointSchemas: Record<string, z.ZodType<unknown>> = {
  '/auth': apiResponseSchema.extend({ token: z.string().optional(), profile: profileSchema.optional() }),
  '/conversations': apiResponseSchema.extend({
    conversation: conversationSchema.optional(),
    conversations: z.array(conversationSchema).optional(),
    messages: z.array(conversationMessageSchema).optional()
  }),
  '/dispatch': apiResponseSchema.extend({
    dispatch: dispatchRowSchema.optional(),
    dispatches: z.array(dispatchRowSchema).optional()
  }),
  '/feedback': apiResponseSchema.extend({ reaction: z.string().optional() }),
  '/memory': apiResponseSchema.extend({ profile: profileSchema.optional(), account: accountOverviewSchema.optional() }),
  '/curiosity-map': apiResponseSchema.extend({
    nodes: z.array(curiosityNodeSchema).optional(),
    sources: z.array(archiveItemSchema).optional()
  })
};

const streamBaseSchema = apiResponseSchema.extend({
  mode: z.string().optional(),
  delta: z.string().optional(),
  answer: z.string().optional(),
  citations: z.array(citationSchema).optional(),
  experience: experienceSchema.optional(),
  commentary: z.string().optional(),
  detail: z.string().optional(),
  note: z.string().optional(),
  kind: z.string().optional(),
  tool_name: z.string().optional(),
  toolName: z.string().optional(),
  brief: dispatchBriefSchema.optional()
});

const streamSchemas: Record<string, z.ZodType> = {
  meta: streamBaseSchema.extend({ request_id: z.string().optional(), conversation_id: z.string().optional() }),
  status: streamBaseSchema,
  commentary: streamBaseSchema,
  answer_delta: streamBaseSchema.extend({ delta: z.string() }),
  answer: streamBaseSchema.extend({ answer: z.string() }),
  citations: streamBaseSchema.extend({ citations: z.array(citationSchema) }),
  experience: streamBaseSchema.extend({ experience: experienceSchema }),
  dispatch_brief: streamBaseSchema.extend({ brief: dispatchBriefSchema }),
  done: streamBaseSchema,
  error: streamBaseSchema.extend({ error: z.string() })
};

function contractError(context: string, error: z.ZodError) {
  const detail = error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join('.') || 'response'}: ${issue.message}`)
    .join('; ');
  const result = new Error(`Thingy received an invalid ${context} response.${detail ? ` ${detail}` : ''}`);
  result.cause = error;
  return result;
}

function validateApiResponse(value: unknown, context = 'API'): ThingyApiResponse {
  const endpoint = Object.keys(endpointSchemas).find((path) => context.includes(path));
  const schema = endpoint ? endpointSchemas[endpoint] : apiResponseSchema;
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw contractError(context, parsed.error);
  return parsed.data as ThingyApiResponse;
}

function validateStreamData(eventName: string, value: unknown): ThingyStreamData {
  const schema = streamSchemas[eventName] || streamBaseSchema;
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw contractError(`${eventName || 'stream'} event`, parsed.error);
  return parsed.data as ThingyStreamData;
}

function looseApiError(value: unknown): ThingyApiResponse {
  const parsed = z
    .object({
      error: z.string().optional(),
      message: z.string().optional(),
      errorMessage: z.string().optional(),
      request_id: z.string().optional(),
      requestId: z.string().optional()
    })
    .passthrough()
    .safeParse(value);
  return parsed.success ? (parsed.data as ThingyApiResponse) : {};
}

export { looseApiError, validateApiResponse, validateStreamData };
