# Home Activities

English | [中文](home-activity.zh.md)

A Home Activity is a durable, user-directed undertaking with a stable identity, name, objective, descriptive scope, and creation time. It is independent of any Session; creating or opening one does not start its objective. StorageDomain records keep Activity data separate from context links, requested delegation facts, user-linked output pointers, user reviews and evidence, and append-only user annotation history. The Web /activity command creates, lists, opens, associates, annotates, links outputs, records reviews, and explicitly delegates bounded tasks.

## Saved intent

`ActivityId` is a generated UUID. `ActivityBoundaries.inScope` and `outOfScope` are user-authored descriptions. They do not change sandbox roots, tool policy, or repository access. Opening an Activity displays saved intent and separately recorded delegations. The Activity record itself has no status, Session association, execution, or continuation semantics.

The `home_activities` domain uses format version 1. The separate `home_activity_delegations` domain uses version 5 and reads version-1 through version-4 records. Version 3 first added the Codex start outcome that the strict version-2 reader cannot decode; version 4 records the selected profile and preset at launch; version 5 adds native Claude Code one-shot delegation facts. New DSH `spawn` requests snapshot the launcher profile name and ordered bundle list plus the active Agent preset id and module names before startup. Profile bundle classification is stable only for an exact shipped template list and experimental only when a selected bundle has explicit experimental metadata; preset stability remains unavailable without explicit product classification. Custom profile patches and runtime overlays are not classified. Native Codex and Claude Code record the DSH profile and preset as unavailable because DSH does not own those external compositions. These labels do not establish sandbox isolation, permission enforcement, or Skill qualification, and later configuration changes do not rewrite the saved profile and preset snapshot. Existing records without a profile and preset snapshot remain readable and show those facts as unavailable. Existing `spawn` rows remain readable with their original fields. A `spawn` request stores a proposed child Session id before startup; Codex and Claude Code requests do not invent a DSH Session identity. The proposed `spawn` id does not establish admission. On restart, a request or admission without its later fact becomes `unconfirmed`; no activation is rearmed. A Codex or Claude Code start rejection after dispatch is also `unconfirmed`, because the external run may already have started; do not repeat the task unless you independently confirm it did not start. If `spawn` admission is uncertain, `/activity sessions` can be checked for the proposed id; a missing Session record does not confirm startup failure. An external admission stores its adapter's `SubagentRun.id`, not a DSH Session or native provider conversation id. Activity provides no continuation, resume, transcript inspection, or rollback for external providers. Codex and Claude Code follow their native configuration and permission handling. Provider output remains a report, not verification or user acceptance. DSH runtime policy controls `spawn` permissions; Activity scope is not an authorization constraint. No Session format version changes are involved.

## Delegation outcomes

Provider reports preserve the provider stop reason. Activity views classify only known subagent reasons: `completed`, `error`, `aborted`, `max-tokens`, and `refusal`; unknown reasons remain unknown. They show the report source and observation time, and the uncertainty source category and observation time when available. DSH has no freshness check or later provider-status query for a saved report, so its freshness is unknown and it may be stale. Missing reports remain pending or unconfirmed according to the saved lifecycle facts; opening an Activity never retries work.

For degraded outcomes, opening an Activity shows inspection guidance for pending or uncertain starts. It offers a separate, explicit new request only when saved facts support new work and the selected provider route is registered; registration does not establish credential readiness, consent, native permission, or admission. Activity has no stop action, and external one-shot runs have no Activity status query, transcript inspection, or resume action. Unclassified outcomes remain unresolved, and opening an Activity never starts or resumes execution.

## Context references

The separate version-1 `home_activity_associations` domain stores selected Workspace and DSH Session ids apart from the Activity record. It permits up to 256 references of each kind. The ids are selected independently: sharing an Activity does not assign a Session to a Workspace or infer a Git repository root from a Workspace directory. Removing a reference changes only the association record; it never rewrites a Workspace record or Session log.

Opening an Activity resolves each id against its owning registry. Removed contexts remain visible as unavailable until the user unlinks them. Catalog, registry, and persistence failures are reported as unknown state instead of being treated as a missing reference.

## Artifact pointers

The separate version-1 `home_activity_artifacts` domain stores user-linked pointers to outputs associated with a specific Activity delegation and a Workspace already linked to that Activity. Each pointer records a label, user-supplied source location, optional source revision, and recording time; missing revisions are displayed as unknown. The service rejects pointers whose delegation belongs to another Activity or whose Workspace is not linked to the Activity.

Artifact pointers do not alter delegation requests, admissions, or reports. Opening an Activity displays the delegation's requesting Session and user-selected Workspace separately, and states that their relationship to the reported output is unverified. Workspace and Session links remain independent; the pointer does not imply one shared checkout, a Git root, or automatic cross-Workspace writes, merges, or releases.

## Outcome reviews

The separate version-1 `home_activity_reviews` domain stores one user review per delegation, linked to its owning Activity. No review row means the user disposition is pending. The service accepts a review only after the delegation has a saved provider report. A user can set the current disposition to pending, accepted, declined, or requires investigation, and append separately attributed evidence that records a user-entered source and reported result. Opening an Activity shows the disposition and each evidence entry separately from its provider report.

Evidence and its result are user-supplied and are not checked by DSH. Conflicting entries remain visible rather than being collapsed into a verification status. Updating a disposition retains the evidence and does not modify delegation requests, admissions, or reports. Reviewing an Activity never starts or retries delegation.

## User annotations

The separate version-1 home_activity_annotations domain stores immutable, user-authored user-command revisions, each linked to the prior revision for that Activity. A correction changes only the current coordination note; it does not edit Activity fields, provider reports, or specialist assertions. Each Activity retains at most 256 revisions, and /activity open shows the current note and latest eight. Note text rejects control, format, line, and paragraph separators so history remains line-oriented. A rejected write may leave persistence uncertain; restart DSH and inspect the saved history before deciding whether to retry.

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

<a id="ctxhomeactivityannotations--homeactivityannotationservice"></a>

### `ctx.homeActivityAnnotations` — `HomeActivityAnnotationService`

Stores append-only user corrections independently from Activity and execution records.

```ts cordis-catalog
/**
 * Append a new current-note revision while retaining each earlier user annotation.
 * @param request - Saved Activity identity and replacement note text.
 * @returns The saved revision with its predecessor and source attribution.
 * @throws {ActivityAnnotationError} when the Activity is unknown, the note is invalid, or history is full.
 * @throws {ActivityAnnotationStorageError} when annotation persistence fails.
 */
correct(request: CorrectActivityAnnotationRequest): Promise<ActivityAnnotation>

/**
 * List user-authored annotation revisions in original order.
 * @param activityId - Stable Activity identity.
 * @returns Detached revisions for the Activity, oldest first.
 * @throws {ActivityAnnotationError} when the Activity does not exist.
 * @throws {ActivityAnnotationStorageError} when annotation storage cannot be read.
 */
list(activityId: ActivityId): readonly ActivityAnnotation[]
```

Source: [`packages/home/activity/src/annotations.ts`](../../packages/home/activity/src/annotations.ts)

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
 * @param admission - Local Session or external execution and activation references.
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

/** Record a startup or report outcome that cannot be confirmed.
 * @param id - Saved request identity.
 * @param admission - New activation references, or undefined to preserve an existing reference or when startup outcome is unknown.
 * @param reason - Why its result is unknown.
 * @returns The unconfirmed record.
*/
async markUnconfirmed( id: ActivityDelegationId, admission: ActivityDelegationAdmission | undefined, reason: ActivityDelegationUncertainty['reason'], ): Promise<ActivityDelegation>
```

Source: [`packages/home/activity/src/delegations.ts`](../../packages/home/activity/src/delegations.ts)

<a id="ctxhomeactivityreviews--homeactivityreviewservice"></a>

### `ctx.homeActivityReviews` — `HomeActivityReviewService`

User dispositions and verification evidence stored independently from delegation reports.

```ts cordis-catalog
/**
 * Record a user disposition and optionally append one user-supplied evidence entry.
 * @param request - Activity, owned delegation, disposition, and optional evidence.
 * @returns The durable review, without changing the delegation report.
 * @throws {ActivityReviewError} when an identity is invalid, no report is saved, or the evidence limit is reached.
 * @throws {ActivityReviewStorageError} when review persistence fails.
 */
record(request: RecordActivityReviewRequest): Promise<ActivityReview>

/**
 * Read a review for one delegation, returning no row when its disposition is still pending.
 * @param activityId - Saved Activity that owns the delegation.
 * @param delegationId - Delegation identity selected for review.
 * @returns The saved review, or `undefined` when the user has not recorded one.
 * @throws {ActivityReviewError} when either identity is unavailable or mismatched.
 * @throws {ActivityReviewStorageError} when review storage cannot be read.
 */
get(activityId: ActivityId, delegationId: ActivityDelegationId): ActivityReview | undefined

/**
 * List user reviews belonging to one saved Activity.
 * @param activityId - Stable Activity identity.
 * @returns Detached reviews, newest update first.
 * @throws {ActivityReviewError} when the Activity does not exist.
 * @throws {ActivityReviewStorageError} when review storage cannot be read.
 */
list(activityId: ActivityId): readonly ActivityReview[]
```

Source: [`packages/home/activity/src/reviews.ts`](../../packages/home/activity/src/reviews.ts)
<!-- END GENERATED cordis-surface -->
