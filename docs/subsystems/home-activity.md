# Home Activities

English | [中文](home-activity.zh.md)

A Home Activity is a durable, user-directed undertaking with a stable identity, name, objective, descriptive scope statements, and creation time. It is independent of any Session; creating or opening one does not start its objective. The `home-activity` package stores Activity records, context references, explicitly requested delegation facts, user-linked artifact pointers, and user-supplied external handoffs in separate [StorageDomain](storage.md) records. The Web [`/activity` command](../../packages/interaction/command-home-activity/README.md) creates, lists, opens, associates contexts, records artifact pointers and external handoffs, and explicitly delegates a bounded task.

## Saved intent

`ActivityId` is a generated UUID. `ActivityBoundaries.inScope` and `outOfScope` are user-authored descriptions. They do not change sandbox roots, tool policy, or repository access. Opening an Activity displays saved intent and separately recorded delegations. The Activity record itself has no status, Session association, execution, or continuation semantics.

The `home_activities` domain uses format version 1. The separate `home_activity_delegations` version-1 domain stores the request and proposed child Session id before startup, then stores accepted DSH admission and provider report as distinct facts. The proposed id does not establish admission. On restart, a request or admission without its later fact becomes `unconfirmed`; no activation is rearmed. If admission is uncertain, `/activity sessions` can be checked for the proposed id; a missing Session record does not confirm startup failure. Provider output remains a report, not verification or user acceptance. DSH runtime policy controls child permissions; Activity scope is not an authorization constraint. No Session format version changes are involved.

## Context references

The separate version-1 `home_activity_associations` domain stores selected Workspace and DSH Session ids apart from the Activity record. It permits up to 256 references of each kind. The ids are selected independently: sharing an Activity does not assign a Session to a Workspace or infer a Git repository root from a Workspace directory. Removing a reference changes only the association record; it never rewrites a Workspace record or Session log.

Opening an Activity resolves each id against its owning registry. Removed contexts remain visible as unavailable until the user unlinks them. Catalog, registry, and persistence failures are reported as unknown state instead of being treated as a missing reference.

## Artifact pointers

The separate version-1 `home_activity_artifacts` domain stores user-linked pointers to outputs associated with a specific Activity delegation and a Workspace already linked to that Activity. Each pointer records a label, user-supplied source location, optional source revision, and recording time; missing revisions are displayed as unknown. The service rejects pointers whose delegation belongs to another Activity or whose Workspace is not linked to the Activity.

Artifact pointers do not alter delegation requests, admissions, or reports. Opening an Activity displays the delegation's requesting Session and user-selected Workspace separately, and states that their relationship to the reported output is unverified. Workspace and Session links remain independent; the pointer does not imply one shared checkout, a Git root, or automatic cross-Workspace writes, merges, or releases.

## External handoffs

The separate version-1 `home_activity_handoffs` domain stores a user-supplied source label, optional summary or source reference, optional artifact references, and the DSH Session in which the handoff was recorded. A handoff must contain a summary, source reference, or artifact reference. Opening the Activity from another DSH Session displays it as external user input, not native execution history. The service does not import transcripts, synchronize an external Session, or claim that the reported work was executed, verified, or accepted.

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

<a id="ctxhomeactivityartifacts--homeactivityartifactservice"></a>

### `ctx.homeActivityArtifacts` — `HomeActivityArtifactService`

Stores user-linked artifact pointers independently from delegation lifecycle facts.

```ts cordis-catalog
/**
 * Record a user-linked pointer after confirming its Activity, delegation, and selected Workspace references.
 * @param request - User-supplied label, location, optional revision, and selected identities.
 * @returns The durable pointer; this does not confirm its Workspace matches execution or who produced it.
 * @throws {ActivityArtifactError} when identities are missing, mismatched, or unlinked.
 * @throws {ActivityArtifactStorageError} when pointer persistence fails.
 */
create(request: CreateActivityArtifactRequest): Promise<ActivityArtifactReference>

/**
 * List user-linked pointers for one Activity, newest first.
 * @param activityId - Stable Activity identity.
 * @returns Detached pointers belonging to the Activity.
 * @throws {ActivityArtifactError} when the Activity does not exist.
 * @throws {ActivityArtifactStorageError} when artifact storage cannot be read.
 */
list(activityId: ActivityId): readonly ActivityArtifactReference[]
```

Source: [`packages/home/activity/src/artifacts.ts`](../../packages/home/activity/src/artifacts.ts)

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

<a id="ctxhomeactivitydelegations--homeactivitydelegationservice"></a>

### `ctx.homeActivityDelegations` — `HomeActivityDelegationService`

Durable request, DSH admission, and provider-report records mounted as `ctx.homeActivityDelegations`.

```ts cordis-catalog
/** Persist a user request before starting any provider work.
 * @param request - Activity, task, provider, and owning Session.
 * @returns The saved request record.
*/
async createRequest(request: CreateActivityDelegationRequest): Promise<ActivityDelegation>

/** List this Activity's delegation facts newest first.
 * @param activityId - Owning Activity identity.
 * @returns Detached records sorted by request time.
*/
list(activityId: ActivityDelegation['activityId']): readonly ActivityDelegation[]

/** Read one delegation by stable identity.
 * @param id - Stable delegation identity.
 * @returns Its latest saved or in-process uncertainty record, or `undefined`.
*/
get(id: ActivityDelegationId): ActivityDelegation | undefined

/** Record a startup rejection that occurred before DSH published an activation.
 * @param id - Saved request identity.
 * @param message - Safe user-facing startup explanation.
 * @returns The rejected request record.
*/
async markNotAdmitted(id: ActivityDelegationId, message: string): Promise<ActivityDelegation>

/** Persist the admission returned by `startActivation`.
 * @param id - Saved request identity.
 * @param admission - Child Session and activation references.
 * @returns The admitted record.
*/
async recordAdmitted(id: ActivityDelegationId, admission: ActivityDelegationAdmission): Promise<ActivityDelegation>

/** Persist the managed activation's result separately from its admission.
 * @param id - Saved request identity.
 * @param admission - Accepted activation references.
 * @param report - Provider-reported result.
 * @returns The completed fact record.
*/
async recordReported( id: ActivityDelegationId, admission: ActivityDelegationAdmission, report: ActivityDelegationReport, ): Promise<ActivityDelegation>

/** Record a result that the activation API could not return as a provider report.
 * @param id - Saved request identity.
 * @param admission - Accepted activation references.
 * @param reason - Why its result is unknown.
 * @returns The unconfirmed record.
*/
async markUnconfirmed( id: ActivityDelegationId, admission: ActivityDelegationAdmission, reason: ActivityDelegationUncertainty['reason'], ): Promise<ActivityDelegation>
```

Source: [`packages/home/activity/src/delegations.ts`](../../packages/home/activity/src/delegations.ts)

<a id="ctxhomeactivityhandoffs--homeactivityhandoffservice"></a>

### `ctx.homeActivityHandoffs` — `HomeActivityHandoffService`

Stores user-supplied external handoffs independently from execution records.

```ts cordis-catalog
/**
 * Record the user-supplied summary and references for work performed outside DSH.
 * @param request - Existing Activity, source, summary or references, and recording Session.
 * @returns The durable handoff explicitly attributed to user input.
 * @throws {ActivityHandoffError} when the Activity is missing or the handoff is invalid.
 * @throws {ActivityHandoffStorageError} when persistence cannot confirm the new record.
 */
create(request: CreateActivityHandoffRequest): Promise<ActivityHandoff>

/**
 * List user-supplied external handoffs for one Activity, newest first.
 * @param activityId - Stable Activity identity.
 * @returns Detached handoff records.
 * @throws {ActivityHandoffError} when the Activity does not exist.
 * @throws {ActivityHandoffStorageError} when handoff storage cannot be read.
 */
list(activityId: ActivityId): readonly ActivityHandoff[]
```

Source: [`packages/home/activity/src/handoffs.ts`](../../packages/home/activity/src/handoffs.ts)
<!-- END GENERATED cordis-surface -->
