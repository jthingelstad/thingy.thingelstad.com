import {
  CloudFormationClient,
  CreateStackCommand,
  DescribeStacksCommand,
  UpdateStackCommand,
  waitUntilStackCreateComplete,
  waitUntilStackUpdateComplete,
} from "@aws-sdk/client-cloudformation";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deploymentParameters } from "./parameters.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const infraRoot = resolve(scriptDir, "..");

function isNoUpdatesError(error) {
  return (
    error?.name === "ValidationError" &&
    /no updates are to be performed/i.test(String(error?.message))
  );
}

export async function main() {
  const region = process.env.AWS_REGION || "us-east-1";
  const stackName = process.env.THINGY_WEB_STACK_NAME || "thingy-web";
  const roleArn = process.env.THINGY_CFN_ROLE_ARN;
  if (!roleArn) throw new Error("Missing deployment setting THINGY_CFN_ROLE_ARN");

  const cloudformation = new CloudFormationClient({ region });
  let exists = true;
  try {
    await cloudformation.send(new DescribeStacksCommand({ StackName: stackName }));
  } catch (error) {
    if (error?.name === "ValidationError") exists = false;
    else throw error;
  }

  const common = {
    StackName: stackName,
    TemplateBody: await readFile(resolve(infraRoot, "template.yaml"), "utf8"),
    Parameters: deploymentParameters({
      environment: process.env,
      stackExists: exists,
    }),
    RoleARN: roleArn,
    Tags: [
      { Key: "Project", Value: "thingy" },
      { Key: "Environment", Value: "production" },
      { Key: "ManagedBy", Value: "cloudformation" },
      { Key: "Repository", Value: "jthingelstad/thingy.thingelstad.com" },
    ],
  };

  if (exists) {
    let updated = true;
    try {
      await cloudformation.send(new UpdateStackCommand(common));
    } catch (error) {
      if (isNoUpdatesError(error)) updated = false;
      else throw error;
    }
    if (updated) {
      const wait = await waitUntilStackUpdateComplete(
        { client: cloudformation, maxWaitTime: 1_800 },
        { StackName: stackName },
      );
      if (wait.state !== "SUCCESS")
        throw new Error(`Stack update ended in ${wait.state}`);
    } else {
      console.log("CloudFormation is already at the requested version.");
    }
  } else {
    await cloudformation.send(
      new CreateStackCommand({ ...common, OnFailure: "ROLLBACK" }),
    );
    const wait = await waitUntilStackCreateComplete(
      { client: cloudformation, maxWaitTime: 1_800 },
      { StackName: stackName },
    );
    if (wait.state !== "SUCCESS")
      throw new Error(`Stack creation ended in ${wait.state}`);
  }
  console.log(`Stack ${stackName} is up to date.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
