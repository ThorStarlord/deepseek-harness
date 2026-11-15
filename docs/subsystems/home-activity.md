# Home Activities

English | [中文](home-activity.zh.md)

A Home Activity is a durable, user-directed undertaking with a stable identity, name, objective, descriptive scope statements, and creation time. It is independent of any Session and does not create a Goal, Workflow, Workspace project, or execution. The `home-activity` package stores records through the shared [StorageDomain](storage.md) form. The Web [`/activity` command](../../packages/interaction/command-home-activity/README.md) creates, lists, and opens them.

## Saved intent

`ActivityId` is a generated UUID. `ActivityBoundaries.inScope` and `outOfScope` are user-authored descriptions. They do not change sandbox roots, tool policy, or repository access. Opening an Activity only displays the saved intent. This initial record has no status, Session association, execution, or continuation semantics.

The `home_activities` domain uses format version 1. The schema requires a non-empty name and objective, at least one in-scope statement, at most 20 statements per list, and bounded text lengths. Invalid stored records fail domain opening. No Session format version changes are involved.

## Cordis API

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxhomeactivities--homeactivityservice"></a>

### `ctx.homeActivities` — `HomeActivityService`

Durable Activity catalog mounted as `ctx.homeActivities`.

```ts cordis-catalog
/**
 * Save a new Activity without creating a Session, Goal, or execution.
 * @param request - Name, objective, and descriptive scope statements.
 * @returns the saved record with its stable identity and creation time.
 */
async create(request: CreateActivityRequest): Promise<Activity>

/**
 * List saved Activities newest first. This read does not activate execution.
 * @returns a detached snapshot of the saved records.
 */
list(): readonly Activity[]

/**
 * Read one saved Activity by stable identity.
 * @param id - Stable Activity identity.
 * @returns a detached record, or `undefined` when no such Activity exists.
 */
get(id: ActivityId): Activity | undefined
```

Source: [`packages/home/activity/src/index.ts`](../../packages/home/activity/src/index.ts)
<!-- END GENERATED cordis-surface -->
