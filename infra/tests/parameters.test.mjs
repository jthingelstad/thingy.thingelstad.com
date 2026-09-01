// The parameter-wipe guard, ported from drop.poapkings.com (which shipped a
// production wipe on 2026-07-23): CloudFormation resets any declared parameter
// absent from an UpdateStack request to its template Default, so every
// template parameter must be sent by deploymentParameters(), and everything
// sent must be declared.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { deploymentParameters } from "../scripts/parameters.mjs";

const infraRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function templateParameterKeys() {
  const template = await readFile(resolve(infraRoot, "template.yaml"), "utf8");
  const section = template.match(/^Parameters:\n([\s\S]*?)^[A-Za-z]/m)?.[1];
  assert.ok(section, "template.yaml must declare a Parameters block");
  const keys = [...section.matchAll(/^  ([A-Za-z0-9]+):/gm)].map(([, key]) => key);
  assert.ok(keys.length > 0, "the Parameters block parse must not be vacuous");
  return keys;
}

test("every template parameter is sent on update", async () => {
  const declared = await templateParameterKeys();
  const sent = deploymentParameters({ environment: {}, stackExists: true }).map(
    ({ ParameterKey }) => ParameterKey,
  );
  const missing = declared.filter((key) => !sent.includes(key));
  assert.deepEqual(
    missing,
    [],
    `template parameters never sent by deploymentParameters(): ${missing.join(", ")}`,
  );
});

test("no undeclared parameter is ever sent", async () => {
  const declared = await templateParameterKeys();
  const sent = deploymentParameters({
    environment: {
      THINGY_WEB_CERTIFICATE_ARN: "arn:aws:acm:us-east-1:1:certificate/x",
      THINGY_WEB_ORIGIN_TOKEN: "0123456789abcdef0123456789abcdef",
    },
    stackExists: false,
  }).map(({ ParameterKey }) => ParameterKey);
  const unknown = sent.filter((key) => !declared.includes(key));
  assert.deepEqual(
    unknown,
    [],
    `parameters sent but not declared in template.yaml: ${unknown.join(", ")}`,
  );
});

test("explicit value wins, previous value preserved, create requires secrets", () => {
  const explicit = deploymentParameters({
    environment: {
      THINGY_WEB_CERTIFICATE_ARN: "arn:aws:acm:us-east-1:1:certificate/x",
      THINGY_WEB_ORIGIN_TOKEN: "0123456789abcdef0123456789abcdef",
    },
    stackExists: true,
  });
  assert.deepEqual(explicit, [
    {
      ParameterKey: "WebCertificateArn",
      ParameterValue: "arn:aws:acm:us-east-1:1:certificate/x",
    },
    {
      ParameterKey: "WebOriginToken",
      ParameterValue: "0123456789abcdef0123456789abcdef",
    },
  ]);

  const preserved = deploymentParameters({ environment: {}, stackExists: true });
  assert.deepEqual(preserved, [
    { ParameterKey: "WebCertificateArn", UsePreviousValue: true },
    { ParameterKey: "WebOriginToken", UsePreviousValue: true },
  ]);

  assert.throws(
    () => deploymentParameters({ environment: {}, stackExists: false }),
    /THINGY_WEB_ORIGIN_TOKEN/,
  );
  const created = deploymentParameters({
    environment: { THINGY_WEB_ORIGIN_TOKEN: "0123456789abcdef0123456789abcdef" },
    stackExists: false,
  });
  assert.deepEqual(created, [
    {
      ParameterKey: "WebOriginToken",
      ParameterValue: "0123456789abcdef0123456789abcdef",
    },
  ]);
});
