// @ts-check
import { DEFAULT_API_TIMEOUT_MS } from './thingy-timeouts.ts';
import { looseApiError, validateApiResponse } from './thingy-contracts.ts';

async function postJsonRequest(options: ThingyRequestOptions = {}): Promise<ThingyApiResponse> {
  const baseUrl = String(options.baseUrl || '').replace(/\/$/, '');
  if (!baseUrl) throw new Error(options.missingMessage || 'Thingy has not been connected to the API yet.');

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), Number(options.timeoutMs || DEFAULT_API_TIMEOUT_MS));
  const response = await window
    .fetch(`${baseUrl}${options.path || ''}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.headers || {})
      },
      body: JSON.stringify(options.payload || {}),
      signal: controller.signal
    })
    .catch((error: unknown) => {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(options.abortMessage || 'Thingy took too long to respond. Please try again.');
      }
      throw error;
    })
    .finally(() => {
      window.clearTimeout(timeout);
    });

  const raw = await response.json().catch(() => ({}));
  if (response.ok) return validateApiResponse(raw, options.path || 'API');
  const data = looseApiError(raw);

  const headerRequestId = response.headers.get('x-request-id') || '';
  const dataRequestId = data.request_id || data.requestId || '';
  const requestId =
    options.requestIdSource === 'data' ? dataRequestId || headerRequestId : headerRequestId || dataRequestId;
  const message = data.error || data.message || options.defaultErrorMessage || `Request failed (${response.status})`;
  const error = new Error(requestId ? `${message} Reference: ${requestId}` : message);
  error.status = response.status;
  error.requestId = requestId;
  error.data = data;
  throw error;
}

export { postJsonRequest };
