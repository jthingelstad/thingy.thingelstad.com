import {
  LIBRARIAN_CONTRACT_SHA256,
  LIBRARIAN_CONTRACT_VERSION,
  validateEndpointContract,
  validateStreamContract,
  type LibrarianApiResponse,
  type LibrarianContractIssue,
  type LibrarianStreamBase
} from '../generated/librarian-contract.generated.ts';

function contractError(context: string, errors: LibrarianContractIssue[]) {
  const detail = errors
    .slice(0, 3)
    .map((issue) => `${issue.instancePath.replace(/^\//, '').replaceAll('/', '.') || 'response'}: ${issue.message}`)
    .join('; ');
  return new Error(`Thingy received an invalid ${context} response.${detail ? ` ${detail}` : ''}`);
}

function contractMajor(version: string) {
  return /^([0-9]+)\./.exec(version)?.[1] || '';
}

function compatibleContractVersion(version: string) {
  return Boolean(version) && contractMajor(version) === contractMajor(LIBRARIAN_CONTRACT_VERSION);
}

function validateApiResponse(value: unknown, context = 'API', action = ''): ThingyApiResponse & LibrarianApiResponse {
  const errors = validateEndpointContract(value, context, action);
  if (errors.length) throw contractError(context, errors);
  return value as ThingyApiResponse & LibrarianApiResponse;
}

function validateStreamData(eventName: string, value: unknown): ThingyStreamData & LibrarianStreamBase {
  const errors = validateStreamContract(eventName, value);
  if (errors.length) throw contractError(`${eventName || 'stream'} event`, errors);
  const data = value as ThingyStreamData & LibrarianStreamBase;
  if (data.contract_version && !compatibleContractVersion(data.contract_version)) {
    throw new Error(
      `Thingy received Librarian contract ${data.contract_version}; this client expects ${LIBRARIAN_CONTRACT_VERSION}.`
    );
  }
  return data;
}

function assertContractResponseVersion(response: Response) {
  const version = response.headers.get('x-librarian-contract-version') || '';
  if (version && !compatibleContractVersion(version)) {
    throw new Error(
      `Thingy received Librarian contract ${version}; this client expects ${LIBRARIAN_CONTRACT_VERSION}.`
    );
  }
}

function contractRequestHeaders() {
  return { 'x-librarian-contract-version': LIBRARIAN_CONTRACT_VERSION };
}

function looseApiError(value: unknown): ThingyApiResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as ThingyApiResponse;
}

export {
  LIBRARIAN_CONTRACT_SHA256,
  LIBRARIAN_CONTRACT_VERSION,
  assertContractResponseVersion,
  contractRequestHeaders,
  looseApiError,
  validateApiResponse,
  validateStreamData
};
