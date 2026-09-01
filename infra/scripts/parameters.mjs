// On UpdateStack, CloudFormation resets EVERY parameter that is absent from
// the request to its template Default, and an in-code literal silently
// overwrites the deployed value - the same bug in a different shape. This
// discipline (explicit env value, else UsePreviousValue, else omit so the
// template Default applies on create) is ported from drop.poapkings.com, which
// shipped a production parameter wipe on 2026-07-23 before adopting it.
// tests/parameters.test.mjs cross-checks this list against the template.
const PRESERVED_PARAMETERS = [
  // Empty until the ACM certificate for thingy.thingelstad.com is issued;
  // then supplied once (with the alias attach) and preserved thereafter.
  ["WebCertificateArn", "THINGY_WEB_CERTIFICATE_ARN"],
];

function preservedParameter(parameterKey, value, stackExists) {
  if (value) return { ParameterKey: parameterKey, ParameterValue: value };
  if (stackExists) return { ParameterKey: parameterKey, UsePreviousValue: true };
  return undefined;
}

export function deploymentParameters({ environment, stackExists }) {
  const parameters = [];
  for (const [parameterKey, environmentKey] of PRESERVED_PARAMETERS) {
    const parameter = preservedParameter(
      parameterKey,
      environment[environmentKey]?.trim(),
      stackExists,
    );
    if (parameter) parameters.push(parameter);
  }
  return parameters;
}
