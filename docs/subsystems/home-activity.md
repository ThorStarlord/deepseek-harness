# Home Activities

English | [中文](home-activity.zh.md)

A Home Activity is a durable, user-directed undertaking with a stable identity, name, objective, descriptive scope, and creation time. It is independent of any Session; creating or opening one does not start its objective. StorageDomain records keep Activity data separate from context links, requested delegation facts, user-linked output pointers, user reviews and evidence, append-only user annotation history, and advisory strategic episodes. The Web /activity command creates, lists, opens, associates, annotates, links outputs, records reviews, requests strategic assessments, and explicitly delegates bounded tasks.

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

## External handoffs

The separate version-1 `home_activity_handoffs` domain stores a user-supplied source label, optional summary or source reference, optional artifact references, and the DSH Session in which the handoff was recorded. A handoff must contain a summary, source reference, or artifact reference. Opening the Activity from another DSH Session displays it as external user input, not native execution history. The service does not import transcripts, synchronize an external Session, or claim that the reported work was executed, verified, or accepted.

## Strategic briefs

The separate version-1 `home_activity_strategic_episodes` domain appends agent-authored advisory briefs without changing Activity intent, annotations, or delegation facts. `/activity assess` loads the existing Sensemaking Skills and explicitly selected Workspaces; repository reads use the existing read-only coordinator after its separate one-shot approval. Each episode retains the Activity objective, originating Session, Workspace ids, coordinator-reported Git revisions and observation times, whether staged, unstaged, or untracked source files were present, source references, loaded Skill content digests, findings, alternatives, uncertainties, and a recommendation or no-selection. The recorder binds repository ids and source metadata to matching successful coordinator tool-result metadata in the originating Session; it does not independently verify source contents, citations, or findings. Unavailable, dirty, changed, or stability-unknown sources require an incomplete brief. A later brief supersedes the recommendation without removing the earlier episode. `/activity open` shows the latest brief and `/activity brief` retrieves a selected historical revision without re-reading repositories; a later saved observation makes earlier applicability uncertain, and no later observation leaves current applicability unconfirmed. `/activity assess cancel` prevents saving an unfinished brief but cannot stop reads already approved and running.

The separate version-1 `home_activity_responsibilities` domain appends facts for a bounded responsibility proposed for a selected Workspace and existing DSH root Session. A proposal, authenticated user confirmation, prompt dispatch intent and outcome, passive Session observation, target report, verification evidence, and user acceptance remain distinct records. Each fact carries stable Activity and responsibility identities, a revision and predecessor, an idempotency request identity, and source attribution. The confirmation stores the exact proposal content and the local owner identity supplied by the trusted Host route; unrelated Peer metadata is not persisted. The persistence service does not authenticate the caller or authorize target access. A prompt accepted by Session Controller means only that the target accepted input. Target reports retain a bounded summary and source event sequences instead of copying the Session transcript. Verification evidence records its named source and reported result; acceptance remains a separate user decision. Listing responsibility history does not query, resume, or prompt a target Session.

The optional `ctx.homeActivityCoordination` Host service exposes Client-mediated routes for owner-authorized, bounded Session discovery, proposal recording, confirmed prompt dispatch, and passive reconciliation. Each discovery rechecks Activity links, Workspace membership, root Session identity, matching repository paths, and current resource access. Proposals cite a model-authored event from an associated coordinating root Session in an associated Workspace. Dispatch accepts only the exact saved proposal after authenticated owner confirmation and rechecks target identity and access; the target Session retains its runtime, permissions, and writer ownership. Opening coordination history does not prompt or resume any target. See the [coordination UI package](../../packages/client/ui-activity-coordination/README.md) for the client workflow.

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

<a id="ctxhomeactivitycoordination--activitycoordinationservice"></a>

### `ctx.homeActivityCoordination` — `ActivityCoordinationService`

Authenticated Client API for Activity-scoped, passive Session discovery.

```ts cordis-catalog
/**
 * List saved Activities visible to the authenticated caller, with their separately selected references.
 * @returns newest-first Activities and descriptive Workspace and Session links.
 */
@Remote('activities') activities(): readonly ActivityCoordinationCatalogItem[]

/**
 * Read bounded recent text from explicitly selected associated root Sessions without activating them.
 * Every request is checked for the Activity, each Workspace, and each Session at the Gateway, then the
 * Host verifies the saved links, current Workspace membership, root identity, and Session cwd.
 * @param request - Activity and one to sixteen distinct Workspace/Session pairs.
 * @param signal - cancellation for all cold Session observations.
 * @returns exact observations ordered as requested, at their own Session-log cursors.
 */
@Remote({ resources: { activity: request => request.activityId, workspace: request => request.targets.map(target => target.workspaceId), session: request => request.targets.map(target => target.sessionId), } }) async discover( request: { readonly activityId: ActivityId; readonly targets: readonly ActivityCoordinationTarget[] }, signal: AbortSignal, ): Promise<readonly ActivityCoordinationSessionSnapshot[]>

/**
 * Recover responsibility histories whose Activity, Workspace, and target Session are still readable.
 * @param request - saved Activity identity.
 * @returns histories in append order without exposing references the caller cannot read.
 */
@Remote({ resources: { activity: request => request.activityId } }) responsibilities(request: { readonly activityId: ActivityId }): ActivityCoordinationResponsibilityList

/**
 * Save an agent recommendation only when its source is an attributed assistant message in the coordinating Session.
 * This operation records advisory intent; it does not confirm or send the task.
 * @param request - bounded proposal, selected target, and exact source message identity.
 * @param signal - cancellation for passive source and target reads.
 * @returns the append-only proposal fact and stable responsibility identity.
 */
@Remote({ resources: { activity: request => request.activityId, workspace: request => request.target.workspaceId, session: request => [request.coordinatingSessionId, request.target.sessionId], } }) async propose( request: ActivityCoordinationProposalRequest, signal: AbortSignal, ): Promise<ActivityResponsibilityProposedFact>

/**
 * Recover append-only histories for an Activity without waking target Sessions.
 * @param request - Activity identity and responsibility identity.
 * @returns the history when the caller can read both its Workspace and target Session.
 */
@Remote({ resources: { activity: request => request.activityId } }) responsibility(request: { readonly activityId: ActivityId; readonly responsibilityId: ActivityResponsibilityId }): ActivityResponsibilityHistory

/**
 * Bind the displayed immutable proposal to an authenticated user confirmation, then send it through the native Session prompt route.
 * The nested Gateway call rechecks the caller's actual `session/prompt` grant for the exact target.
 * @param request - proposal echo, authenticated confirmation id, and native prompt request id.
 * @param signal - cancellation for target validation and prompt admission.
 * @returns confirmed admission, known non-admission, or an explicitly uncertain result with recovered history.
 */
@Remote({ resources: { activity: request => request.activityId, workspace: request => request.proposal.target.workspaceId, session: request => request.proposal.target.sessionId, } }) async dispatchConfirmed( request: ActivityCoordinationDispatchRequest, signal: AbortSignal, ): Promise<ActivityCoordinationDispatchResult>

/**
 * Read current target state and append a source-attributed observation; it does not resume the target.
 * @param request - Activity responsibility and exact Workspace/Session target.
 * @param signal - cancellation for passive reads.
 * @returns the new observation and complete responsibility history.
 */
@Remote({ resources: { activity: request => request.activityId, workspace: request => request.workspaceId, session: request => request.sessionId, } }) async observeResponsibility( request: { readonly activityId: ActivityId; readonly responsibilityId: ActivityResponsibilityId; readonly workspaceId: WorkspaceId; readonly sessionId: SessionId }, signal: AbortSignal, ): Promise<ActivityResponsibilityHistory>

/**
 * Reconcile one responsibility against its exact target request id using only passive Session reads.
 * @param request - Activity, responsibility, and exact Workspace/Session identity.
 * @param signal - cancellation of the state and history reads.
 * @returns current execution state plus a report only when its matching target turn completed.
 */
@Remote({ resources: { activity: request => request.activityId, workspace: request => request.workspaceId, session: request => request.sessionId, } }) async reconcileResponsibility( request: { readonly activityId: ActivityId; readonly responsibilityId: ActivityResponsibilityId; readonly workspaceId: WorkspaceId; readonly sessionId: SessionId }, signal: AbortSignal, ): Promise<ActivityCoordinationReconcileResult>
```

Types: [SessionId](core.md) · [WorkspaceId](workspace.md)

Source: [`packages/home/activity/src/coordination.ts`](../../packages/home/activity/src/coordination.ts)

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

<a id="ctxhomeactivityresponsibilities--homeactivityresponsibilityservice"></a>

### `ctx.homeActivityResponsibilities` — `HomeActivityResponsibilityService`

Immutable Activity responsibility facts mounted as `ctx.homeActivityResponsibilities`.

```ts cordis-catalog
/** Save an immutable recommendation without authorizing or dispatching it.
 * @param request - Activity, coordinator source, selected target, and exact bounded task.
 * @returns The saved proposal and its stable responsibility identity.
 * @throws {ActivityResponsibilityError} when the Activity or request is invalid, or the idempotency key conflicts.
 * @throws {ActivityResponsibilityStorageError} when persistence cannot be confirmed.
 */
createProposal(request: CreateActivityResponsibilityRequest): Promise<ActivityResponsibilityProposedFact>

/** Record a Client-authenticated confirmation of the complete immutable proposal.
 * @param request - Exact proposal echo, idempotency key, and principal read by the trusted Client route.
 * @returns The confirmed fact; this record does not itself dispatch work.
 * @throws {ActivityResponsibilityError} when the proposal is unavailable, differs, or was confirmed already.
 * @throws {ActivityResponsibilityStorageError} when persistence cannot be confirmed.
 */
confirm(request: ConfirmActivityResponsibilityRequest): Promise<ActivityResponsibilityConfirmedFact>

/** Persist dispatch intent before the authenticated Client prompts the target Session.
 * @param request - Activity responsibility and the exact Session prompt request id.
 * @returns The durable dispatch intent.
 * @throws {ActivityResponsibilityError} when confirmation is missing or an attempt already exists.
 * @throws {ActivityResponsibilityStorageError} when persistence cannot be confirmed.
 */
beginDispatch(request: BeginActivityResponsibilityDispatchRequest): Promise<ActivityResponsibilityDispatchAttemptedFact>

/** Append the prompt route's confirmed, rejected, or uncertain admission result.
 * @param request - Exact prompt request identity and route outcome.
 * @returns The persisted dispatch result, without claiming target execution.
 * @throws {ActivityResponsibilityError} when no matching attempt exists or its result conflicts.
 * @throws {ActivityResponsibilityStorageError} when persistence cannot be confirmed.
 */
settleDispatch(request: SettleActivityResponsibilityDispatchRequest): Promise<ActivityResponsibilityDispatchSettledFact>

/** Record a passive target Session state observation without treating it as task completion.
 * @param request - Activity, responsibility, source time, and Session Controller state.
 * @returns The append-only observation fact.
 * @throws {ActivityResponsibilityError} when the Activity or responsibility is unavailable or the request conflicts.
 * @throws {ActivityResponsibilityStorageError} when persistence cannot be confirmed.
 */
recordObservation(request: RecordActivityResponsibilityObservationRequest): Promise<ActivityResponsibilityObservedFact>

/** Record a bounded target-authored summary linked to the target's original Session events.
 * @param request - Summary, target prompt identity, and non-empty source event sequences.
 * @returns The provider-reported fact; it is not independently verified or accepted.
 * @throws {ActivityResponsibilityError} when no matching dispatch or source Session exists.
 * @throws {ActivityResponsibilityStorageError} when persistence cannot be confirmed.
 */
recordReport(request: RecordActivityResponsibilityReportRequest): Promise<ActivityResponsibilityReportedFact>

/** Record separately attributed evidence about one saved target report.
 * @param request - Report identity, recorder, and named verification evidence.
 * @returns The evidence fact; DSH does not independently inspect its source.
 * @throws {ActivityResponsibilityError} when the referenced report is unavailable or the request conflicts.
 * @throws {ActivityResponsibilityStorageError} when persistence cannot be confirmed.
 */
recordVerification(request: RecordActivityResponsibilityVerificationRequest): Promise<ActivityResponsibilityVerificationFact>

/** Record a user disposition of one saved report, separately from verification evidence.
 * @param request - Report identity, explicit user disposition, and authenticated principal.
 * @returns The append-only acceptance fact.
 * @throws {ActivityResponsibilityError} when the report is unavailable or the request conflicts.
 * @throws {ActivityResponsibilityStorageError} when persistence cannot be confirmed.
 */
recordAcceptance(request: RecordActivityResponsibilityAcceptanceRequest): Promise<ActivityResponsibilityAcceptanceFact>

/** Read one complete responsibility history without contacting or resuming its target Session.
 * @param activityId - Owning Activity identity.
 * @param responsibilityId - Stable responsibility identity.
 * @returns Its facts oldest first, or `undefined` when the identity is not in this Activity.
 * @throws {ActivityResponsibilityError} when the Activity or history is invalid.
 * @throws {ActivityResponsibilityStorageError} when stored facts cannot be read.
 */
get(activityId: ActivityId, responsibilityId: ActivityResponsibilityId): ActivityResponsibilityHistory | undefined

/** List saved responsibilities for one Activity without contacting their target Sessions.
 * @param activityId - Stable Activity identity.
 * @returns Immutable histories, newest proposal first and facts oldest first.
 * @throws {ActivityResponsibilityError} when the Activity or a stored history is invalid.
 * @throws {ActivityResponsibilityStorageError} when responsibility storage cannot be read.
 */
list(activityId: ActivityId): readonly ActivityResponsibilityHistory[]
```

Source: [`packages/home/activity/src/responsibilities.ts`](../../packages/home/activity/src/responsibilities.ts)

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

<a id="ctxhomeactivitystrategicepisodes--homeactivitystrategicepisodeservice"></a>

### `ctx.homeActivityStrategicEpisodes` — `HomeActivityStrategicEpisodeService`

Stores append-only agent-authored strategic assessments independently from Activity intent and user notes.

```ts cordis-catalog
/** Append a completed or explicitly incomplete agent-authored brief.
 * @param request - Activity, Session, request, Skills, repository observations, and report content.
 * @returns The saved episode, or the prior episode for a repeated request id.
 * @throws {ActivityStrategicEpisodeError} when the Activity is unknown, report content is invalid, or the episode limit is reached.
 * @throws {ActivityStrategicEpisodeStorageError} when episode storage cannot confirm the read or write.
 */
record(request: RecordActivityStrategicEpisodeRequest): Promise<ActivityStrategicEpisode>

/** List historical assessments without checking repositories or starting work.
 * @param activityId - Stable Activity identity.
 * @returns Detached episodes for the Activity, oldest first.
 * @throws {ActivityStrategicEpisodeError} when the Activity does not exist.
 * @throws {ActivityStrategicEpisodeStorageError} when episode storage cannot be read.
 */
list(activityId: ActivityId): readonly ActivityStrategicEpisode[]
```

Source: [`packages/home/activity/src/strategic-episodes.ts`](../../packages/home/activity/src/strategic-episodes.ts)
<!-- END GENERATED cordis-surface -->
