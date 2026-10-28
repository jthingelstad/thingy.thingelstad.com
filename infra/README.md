# thingy-web infrastructure

Web hosting for thingy.thingelstad.com: a private S3 bucket behind CloudFront,
defined in one CloudFormation stack (`thingy-web`, us-east-1) and deployed by
CI through the `ThingyWebDeployOidc` role. Ported from drop.poapkings.com's
migration off GitHub Pages; this site cut over on 2026-09-01
(projects-sysadmin#37 has the migration record).

## What the stack owns

- **S3 bucket** `thingy-web-<account>-us-east-1` - build output only; the
  deploy mirror-and-deletes, so never park other artifacts here.
- **CloudFront distribution** - alias `thingy.thingelstad.com` (Namecheap
  CNAME), default origin S3 via OriginAccessControl, plus the same-origin
  Librarian API: `/api/chat|welcome|feedback` and `/api/tools` pin to the
  native archive Web Function, every other `/api/*` goes to the native auth Web Function,
  with the `/api` prefix stripped by the CloudFront function and the
  `X-Thingy-Origin` marker stamped from the `WebOriginToken` parameter.
  No `CustomErrorResponses` - they apply distribution-wide to every method
  and clobber the API's JSON errors (verified live 2026-09-01).
- **Access logging** - CloudFront standard logs v2 into
  `/thingy-web/web-access` (privacy-minimized field set, 731-day (24-month) retention).
- **Alarm** `thingy-web-distribution-5xx` → the `weekly-thing-librarian-alarms`
  SNS topic. The `thingy-web-` prefix is load-bearing: the sysadmin auditor's
  alarm-history grant matches it.

## Deploying

CI deploys on every push to `main` touching `web/**` or `infra/**`
(`.github/workflows/deploy.yml`, job `deploy-aws`). Manually:

```sh
cd infra && npm ci
AWS_PROFILE=jamie THINGY_CFN_ROLE_ARN=arn:aws:iam::<account>:role/ThingyWebCloudFormationExec \
  node scripts/deploy-stack.mjs
node scripts/deploy-web.mjs   # requires web/_site from a fresh build
```

`scripts/parameters.mjs` carries the parameter-preservation discipline
(explicit env value, else `UsePreviousValue`, else template default) that
`tests/parameters.test.mjs` guards in both directions - CloudFormation resets
any omitted parameter to its default on update, which caused a real
production wipe in the Drop precedent. `WebCertificateArn` (repo variable
`THINGY_WEB_CERTIFICATE_ARN`) and the `WebOriginToken` secret (recorded in
librarian-thing's `.env` as `THINGY_WEB_ORIGIN_TOKEN`; the Librarian Lambdas
hold the same value) are required only at stack creation and preserved
thereafter.

`npm test` runs the parameter guard plus the cache-control and content-type
rules `scripts/deploy-web.mjs` applies per object.

## Native Librarian origins

Supply `NativeAuthDomain` and `NativeArchiveDomain` from the Librarian stack
outputs when creating the stack. Later deployments preserve both. Routing is
always native; API Gateway and the old streaming Function URL have been retired.

Native OAC preserves viewer Authorization while signing the origin request.
The native cache policy forwards Authorization; every dynamic response is no-store.
The request policy carries the session cookie, contract header and trusted
CloudFront viewer address, excludes viewer Host, and retains the existing origin
marker. `/api/tools` stays pinned to the archive origin.

Install `native-cfn-policy.json` as the narrow `ThingyNativeOriginRequests` inline
policy on the existing CloudFormation service role before first deployment. It
adds origin-request-policy lifecycle, which the existing role did not permit.
Rollback changes the Librarian's live native revision pins to its protected
previous revisions; the distribution keeps its stable native live origins.
