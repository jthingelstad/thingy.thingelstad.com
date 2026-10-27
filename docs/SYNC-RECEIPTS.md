# Thingy's serving receipt

Thingy serves the native backend in `librarian-thing`. Rebuilding this static
frontend cannot prove a corpus arrival. The reusable
`report-sync-receipt.yml` workflow is called by the actual backend release,
after native promotion and its health checks. It retains the caller's OIDC
subject and uses the existing `WeeklyThingLibrarianDeployOidc` role, never
the static web delivery role. No new backend or public API field is added.

The caller captures metadata before corpus uploads and after promotion:
public `/health`, current S3 HEAD versions, public newest ids/times, and the
blog's exact permalink when the artifact supplies one. Only matching served
versions enter the snapshots. An unknown baseline, unchanged identity,
unchanged version, regression or stale health cannot report an arrival.
Blog/link metadata also has to advance in time; equal-time newest rows alone
do not prove an absence. A link requires the published producer stamp to
match, never a guessed id from its corpus hash.

The pure selector is `infra/scripts/serving-receipts.mjs`; its event is
`thingy / received`, with `via: api-deploy`. It reads no corpus body,
unpublished document, visitor or secret. Transport is best effort and checks
each entry; failure warns after the healthy backend deploy. Polling remains
the backstop. Reusable calls default to dry run and an empty bus name.

This PR stays unmerged and undeployed during the night. The Librarian
companion must pin both this workflow and its checkout to this reviewed
immutable commit. It provides `sync-before.json` and `sync-after.json` as a
same-run artifact. Applying the reviewed existing deploy-role boundary
change requires Jamie's separate administrator approval; the sync stack's
source-scoped `ThingyReceiverRole` grant cannot bypass it. Configure that
role as `WeeklyThingLibrarianDeployOidc`, then enable the caller's repository
variable `SYNC_THINGY_RECEIVED_BUS=thingelstad-publishing` after both PRs and
the grant are ready. No real permission rehearsal or first delivery is
claimed here; fixtures are the current proof.
