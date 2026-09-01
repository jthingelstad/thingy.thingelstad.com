import {
  CloudFrontClient,
  CreateInvalidationCommand,
  waitUntilInvalidationCompleted,
} from "@aws-sdk/client-cloudfront";
import {
  CloudFormationClient,
  DescribeStacksCommand,
} from "@aws-sdk/client-cloudformation";
import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..");

// GitHub Pages was retired 2026-09-01 and these files are deleted from
// web/public; the skip stays as a guard so a stray reintroduction never
// reaches the bucket (Drop keeps the same defense).
const SKIPPED_KEYS = new Set(["CNAME", ".nojekyll"]);

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webmanifest", "application/manifest+json"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

export function contentTypeFor(key) {
  return (
    CONTENT_TYPES.get(extname(key).toLowerCase()) ?? "application/octet-stream"
  );
}

// HTML revalidates in the browser but CloudFront may hold it five minutes;
// the post-upload /* invalidation collapses that window on every deploy.
export function cacheControlFor(key) {
  if (key.endsWith(".html")) return "public, max-age=0, s-maxage=300";
  if (/^assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:css|js)$/.test(key))
    return "public, max-age=31536000, immutable";
  if (/\.(?:png|svg|woff2?)$/.test(key)) return "public, max-age=604800";
  return "public, max-age=3600";
}

async function filesUnder(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesUnder(root, path)));
    else if (entry.isFile()) {
      const key = relative(root, path).split(sep).join("/");
      if (!SKIPPED_KEYS.has(key)) files.push({ key, path });
    }
  }
  return files;
}

async function concurrently(items, limit, action) {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next];
        next += 1;
        await action(item);
      }
    }),
  );
}

async function existingKeys(s3, bucket) {
  const keys = [];
  let continuationToken;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    );
    keys.push(...(page.Contents ?? []).flatMap(({ Key }) => (Key ? [Key] : [])));
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

function output(stack, key) {
  const value = stack?.Outputs?.find(
    ({ OutputKey }) => OutputKey === key,
  )?.OutputValue;
  if (!value) throw new Error(`Stack did not return ${key}`);
  return value;
}

async function expectResponse(url, check) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
      const body = await response.text();
      if (!check(body)) throw new Error(`${url} returned unexpected content`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 6) await new Promise((wake) => setTimeout(wake, 3_000));
    }
  }
  throw lastError;
}

export async function main() {
  const region = process.env.AWS_REGION || "us-east-1";
  const stackName = process.env.THINGY_WEB_STACK_NAME || "thingy-web";

  const siteRoot = resolve(repoRoot, "web/_site");
  const files = await filesUnder(siteRoot);
  if (!files.some(({ key }) => key === "index.html"))
    throw new Error("The website build is missing web/_site/index.html");
  if (!files.some(({ key }) => key === "404.html"))
    throw new Error("The website build is missing web/_site/404.html");

  const cloudformation = new CloudFormationClient({ region });
  const stack = (
    await cloudformation.send(new DescribeStacksCommand({ StackName: stackName }))
  ).Stacks?.[0];
  const bucket = output(stack, "WebBucketName");
  const distributionId = output(stack, "WebDistributionId");
  const distributionDomain = output(stack, "WebDistributionDomainName");
  const s3 = new S3Client({ region });

  await concurrently(files, 16, async ({ key, path }) => {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: await readFile(path),
        CacheControl: cacheControlFor(key),
        ContentType: contentTypeFor(key),
      }),
    );
  });

  const desired = new Set(files.map(({ key }) => key));
  const stale = (await existingKeys(s3, bucket)).filter((key) => !desired.has(key));
  for (let offset = 0; offset < stale.length; offset += 1_000) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: stale.slice(offset, offset + 1_000).map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );
  }

  const cloudfront = new CloudFrontClient({ region: "us-east-1" });
  const invalidation = await cloudfront.send(
    new CreateInvalidationCommand({
      DistributionId: distributionId,
      InvalidationBatch: {
        CallerReference: `${process.env.GITHUB_SHA ?? "local"}-${randomUUID()}`,
        Paths: { Quantity: 1, Items: ["/*"] },
      },
    }),
  );
  if (!invalidation.Invalidation?.Id)
    throw new Error("CloudFront did not return an invalidation ID");
  const wait = await waitUntilInvalidationCompleted(
    { client: cloudfront, maxWaitTime: 600 },
    { DistributionId: distributionId, Id: invalidation.Invalidation.Id },
  );
  if (wait.state !== "SUCCESS")
    throw new Error(`CloudFront invalidation ended in ${wait.state}`);

  const preview = `https://${distributionDomain}`;
  await Promise.all([
    expectResponse(`${preview}/`, (body) => body.includes("Thingy")),
    expectResponse(`${preview}/chat/`, (body) => body.includes("Thingy")),
    expectResponse(`${preview}/about/`, (body) => body.includes("Thingy")),
  ]);
  console.log(
    `Uploaded ${files.length} web files to ${bucket}; CloudFront preview passed at ${preview}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
