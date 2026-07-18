import contractJson from '../../contracts/librarian-api.v1.json' with { type: 'json' };

interface ContractSchema {
  $ref?: string;
  anyOf?: ContractSchema[];
  enum?: unknown[];
  type?: string;
  properties?: Record<string, ContractSchema>;
  required?: string[];
  items?: ContractSchema;
}

interface ContractIssue {
  instancePath: string;
  message: string;
}

interface LibrarianContractArtifact {
  $schema: string;
  version: string;
  $defs: Record<string, ContractSchema>;
  endpoints: Record<
    string,
    {
      schema: ContractSchema;
      actions: Record<string, ContractSchema>;
    }
  >;
  stream_events: Record<string, ContractSchema>;
}

const contract = contractJson as LibrarianContractArtifact;
const LIBRARIAN_CONTRACT_VERSION = contract.version;
function contractDefinition(ref: string) {
  const prefix = '#/$defs/';
  return ref.startsWith(prefix) ? contract.$defs[ref.slice(prefix.length)] : undefined;
}

function validateSchema(value: unknown, schema: ContractSchema, instancePath = ''): ContractIssue[] {
  if (schema.$ref) {
    const definition = contractDefinition(schema.$ref);
    return definition
      ? validateSchema(value, definition, instancePath)
      : [{ instancePath, message: `references unknown schema ${schema.$ref}` }];
  }
  if (schema.anyOf) {
    if (schema.anyOf.some((candidate) => validateSchema(value, candidate, instancePath).length === 0)) return [];
    return [{ instancePath, message: 'must match an allowed shape' }];
  }
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    return [{ instancePath, message: 'must be an allowed value' }];
  }

  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [{ instancePath, message: 'must be object' }];
    }
    const record = value as Record<string, unknown>;
    const issues: ContractIssue[] = [];
    for (const key of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) {
        issues.push({ instancePath, message: `must have required property '${key}'` });
      }
    }
    for (const [key, propertySchema] of Object.entries(schema.properties || {})) {
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        issues.push(...validateSchema(record[key], propertySchema, `${instancePath}/${key}`));
      }
    }
    return issues;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [{ instancePath, message: 'must be array' }];
    return schema.items
      ? value.flatMap((item, index) => validateSchema(item, schema.items as ContractSchema, `${instancePath}/${index}`))
      : [];
  }
  if (schema.type === 'null') return value === null ? [] : [{ instancePath, message: 'must be null' }];
  if (schema.type && typeof value !== schema.type) {
    return [{ instancePath, message: `must be ${schema.type}` }];
  }
  return [];
}

function contractError(context: string, errors: ContractIssue[]) {
  const detail = (errors || [])
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

function validateApiResponse(value: unknown, context = 'API', action = ''): ThingyApiResponse {
  const endpoint = Object.keys(contract.endpoints).find((path) => context.includes(path));
  const endpointContract = endpoint ? contract.endpoints[endpoint] : null;
  const schema = endpointContract?.actions[action] || endpointContract?.schema || { $ref: '#/$defs/apiResponse' };
  const errors = validateSchema(value, schema);
  if (errors.length) throw contractError(context, errors);
  return value as ThingyApiResponse;
}

function validateStreamData(eventName: string, value: unknown): ThingyStreamData {
  const schema = contract.stream_events[eventName] || { $ref: '#/$defs/streamBase' };
  const errors = validateSchema(value, schema);
  if (errors.length) throw contractError(`${eventName || 'stream'} event`, errors);
  const data = value as ThingyStreamData;
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
  LIBRARIAN_CONTRACT_VERSION,
  assertContractResponseVersion,
  contractRequestHeaders,
  looseApiError,
  validateApiResponse,
  validateStreamData
};
