// @ts-check
const DEFAULT_API_TIMEOUT_MS = 60000;
const AGENT_RESPONSE_TIMEOUT_MS = 190000;
const AGENT_SETUP_TIMEOUT_MS = 45000;
// Max quiet gap between SSE chunks once a stream has started. The server
// emits archive-work status events during tool turns, so a healthy answer
// never goes silent for this long.
const STREAM_IDLE_TIMEOUT_MS = 75000;

export { AGENT_RESPONSE_TIMEOUT_MS, AGENT_SETUP_TIMEOUT_MS, DEFAULT_API_TIMEOUT_MS, STREAM_IDLE_TIMEOUT_MS };
