# Home Activity

[English](home-activity.md) | 中文

Home Activity 是由用户发起并持久保存的事务，包含稳定身份、名称、目标、描述性范围说明和创建时间。它独立于任何 Session；创建或打开 Activity 不会启动其目标。`home-activity` 包会通过独立的 [StorageDomain](storage.zh.md) 记录保存 Activity、上下文引用、明确请求的委派事实、用户关联的产物指针，以及带来源信息的用户处置和验证证据。Web [`/activity` 命令](../../packages/interaction/command-home-activity/README.zh.md) 可创建、列出、打开、关联上下文、记录指针与审核，并明确委派有界任务。

## 已保存意图

`ActivityId` 是生成的 UUID。`ActivityBoundaries.inScope` 和 `outOfScope` 是用户撰写的描述，不会更改 sandbox 根目录、工具策略或仓库访问权限。打开 Activity 会显示已保存意图和单独记录的委派。Activity 记录本身没有状态、Session 关联、执行或继续执行语义。

`home_activities` 域使用格式版本 1。单独的 `home_activity_delegations` 域使用版本 3，并可读取版本 1 和版本 2 记录。由于严格的版本 2 读取器无法解码新增的 Codex 启动结果，必须拒绝其较新版本戳，因此需要升级到版本 3。现有 `spawn` 行仍按原字段读取。`spawn` 请求会在启动前保存拟请求的子级 Session id；Codex 请求不会虚构 DSH Session 身份。Codex 准入会保存其适配器的 `SubagentRun.id`，不是 DSH Session 或原生 Codex 线程 id。拟请求的 `spawn` id 不代表已获准入。应用重启时，缺少后续事实的请求或 admission 会变为 `unconfirmed`；不会重新启动 activation。若 Codex 启动调用在 dispatch 开始后拒绝，记录会保持 `unconfirmed`，因为外部运行可能已经启动；除非独立确认 Codex 未启动，否则不要重复该任务。若 `spawn` 准入状态不确定，可用 `/activity sessions` 检查拟请求的 id；Session 记录缺失不能证明启动失败。Activity 不提供继续、恢复、对话记录检查或回滚。Codex 遵循其原生配置和权限模式。提供方输出只是报告，不代表验证或用户接受。`spawn` 子级权限由 DSH 运行时策略控制；Activity 范围不是授权约束。不涉及 Session 格式版本变更。

## 上下文关联

独立的版本 1 `home_activity_associations` 域会在 Activity 记录之外保存用户选定的 Workspace 和 DSH Session id，每种引用最多 256 个。两类 id 分别选择；共享 Activity 不会把 Session 分配给 Workspace，也不会从 Workspace 目录推断 Git 仓库根目录。删除引用只修改关联记录，不会重写 Workspace 记录或 Session 日志。

打开 Activity 时，系统会通过各自的注册表解析 id。已删除的上下文会标记为不可用，直到用户主动解除关联。目录、注册表或持久化读取失败会显示为未知状态，而不会误报为引用不存在。

## 产物指针

独立的版本 1 `home_activity_artifacts` 域会保存用户关联的输出指针。每个指针关联到特定 Activity 委派和已关联到该 Activity 的 Workspace，并记录标签、用户提供的来源位置、可选来源修订版和记录时间。缺少修订版时会显示为未知。若委派属于其他 Activity，或 Workspace 尚未关联到该 Activity，服务会拒绝该指针。

产物指针不会修改委派请求、准入或报告。打开 Activity 时会分别显示委派发起 Session 与用户选择的 Workspace，并说明两者与报告输出的关系未经验证；Workspace 与 Session 关联始终相互独立。指针不会暗示共享 checkout、Git 根目录，也不会自动触发跨 Workspace 写入、合并或发布。

## 结果审核

独立的版本 1 `home_activity_reviews` 域会为每项委派保存一条用户审核记录，并关联到其所属 Activity。没有审核记录表示用户处置仍为 pending。只有委派的提供方报告已保存后，服务才接受审核记录。用户可以将当前处置设为 pending、accepted、declined 或 requires investigation，并追加分别注明来源的证据，记录用户填写的来源和报告结果。打开 Activity 时会将处置及各条证据与提供方报告分别显示。

证据及其结果由用户提供，DSH 不会检查。相互冲突的记录会分别显示，不会合并为单一验证状态。更新处置会保留证据，也不会修改委派请求、准入或报告。审核 Activity 不会启动或重试委派。

## Cordis API

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [SessionId](core.zh.md) · [WorkspaceId](workspace.zh.md)

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
