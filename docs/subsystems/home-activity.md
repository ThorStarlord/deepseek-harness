# Home Activities

English | [中文](home-activity.zh.md)

Activity intent is durable and independent of the Session where it was written. It has a stable identity, name, objective, descriptive scope statements, and creation time; it does not create a Goal, Workflow, Workspace project, or execution. The `home-activity` package stores intent through the shared [StorageDomain](storage.md) form. The Web [`/activity` command](../../packages/interaction/command-home-activity/README.md) creates, lists, opens, and links Activities.

## Saved intent

`ActivityId` is a generated UUID. `ActivityBoundaries.inScope` and `outOfScope` are user-authored descriptions. They do not change sandbox roots, tool policy, or repository access. Opening an Activity only displays saved intent and separately stored references; it does not start execution or activate a Goal.

The `home_activities` domain uses format version 1 and keeps its strict record unchanged. The schema requires a non-empty name and objective, at least one in-scope statement, at most 20 statements per list, and bounded text lengths. Invalid stored records fail domain opening. No Session format version changes are involved.

## Context references

The additive version-1 `home_activity_associations` domain stores Workspace and DSH Session ids separately from Activity intent, with at most 256 references of each kind per Activity. The service rejects an additional link before writing; callers can unlink a saved reference and retry. Users choose each reference explicitly; a Session reference is not assigned to a Workspace because both ids share an Activity. A Workspace id names a registered DSH Workspace directory, not an inferred Git repository root. Removing or correcting a reference changes only this association record, never the Workspace record or Session log.

Opening an Activity resolves the saved ids against their owning registries. A removed Workspace or Session remains listed as unavailable until the user explicitly unlinks it. Registry read or storage failures are reported instead of being rendered as missing references.

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

<a id="ctxhomeactivityassociations--homeactivityassociationservice"></a>

### `ctx.homeActivityAssociations` — `HomeActivityAssociationService`

Context references persisted separately from the strict Activity v1 record.

```ts cordis-catalog
/**
 * Read separately authored Workspace and Session ids for one saved Activity.
 * @param activityId - Stable Activity identity.
 * @returns Detached ids; an Activity with no links returns two empty arrays.
 * @throws {HomeActivityAssociationError} when the Activity does not exist.
 */
get(activityId: ActivityId): HomeActivityAssociations

/**
 * Add a selected existing Workspace reference; repeated links are idempotent.
 * @param activityId - Saved Activity receiving the reference.
 * @param workspaceId - Existing Workspace registry identity.
 * @returns `true` when a new durable link was written.
 * @throws {HomeActivityAssociationError} when the Activity or Workspace is unknown
 *   or the Activity already has the maximum number of Workspace references.
 */
linkWorkspace(activityId: ActivityId, workspaceId: WorkspaceId): Promise<boolean>

/**
 * Add a selected existing DSH Session reference; repeated links are idempotent.
 * @param activityId - Saved Activity receiving the reference.
 * @param sessionId - Existing DSH Session identity.
 * @returns `true` when a new durable link was written.
 * @throws {HomeActivityAssociationError} when the Activity or Session is unknown
 *   or the Activity already has the maximum number of Session references.
 */
linkSession(activityId: ActivityId, sessionId: SessionId): Promise<boolean>

/**
 * Remove a Workspace reference without mutating its Workspace record.
 * @param activityId - Saved Activity whose reference is removed.
 * @param workspaceId - Workspace identity, including an unavailable old identity.
 * @returns `true` when a durable link was removed.
 * @throws {HomeActivityAssociationError} when the Activity is unknown.
 */
unlinkWorkspace(activityId: ActivityId, workspaceId: WorkspaceId): Promise<boolean>

/**
 * Remove a DSH Session reference without mutating its Session log.
 * @param activityId - Saved Activity whose reference is removed.
 * @param sessionId - Session identity, including an unavailable old identity.
 * @returns `true` when a durable link was removed.
 * @throws {HomeActivityAssociationError} when the Activity is unknown.
 */
unlinkSession(activityId: ActivityId, sessionId: SessionId): Promise<boolean>
```

Types: [SessionId](core.md) · [WorkspaceId](workspace.md)

Source: [`packages/home/activity/src/associations.ts`](../../packages/home/activity/src/associations.ts)
<!-- END GENERATED cordis-surface -->
