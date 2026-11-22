# Home Activity

[English](home-activity.md) | 中文

Home Activity 是由用户发起并持久保存的事务，具有稳定身份、名称、目标、描述性范围和创建时间。它独立于任何 Session；创建或打开 Activity 不会启动目标。StorageDomain 记录将 Activity 与上下文关联、明确请求的委派事实、用户关联的输出指针、用户审核及证据、仅追加的用户备注历史和建议性战略记录分开保存。Web /activity 命令可创建、列出、打开、关联、备注、关联输出、记录审核、请求战略评估，并显式委派有界任务。

## 已保存意图

`ActivityId` 是生成的 UUID。`ActivityBoundaries.inScope` 和 `outOfScope` 是用户撰写的描述，不会更改 sandbox 根目录、工具策略或仓库访问权限。打开 Activity 会显示已保存意图和单独记录的委派。Activity 记录本身没有状态、Session 关联、执行或继续执行语义。

`home_activities` 域使用格式版本 1。单独的 `home_activity_delegations` 域使用版本 5，可读取版本 1 至 4 的记录。版本 3 首次加入 Codex 启动结果，严格的版本 2 读取器无法解码；版本 4 保存启动时的 profile 和 preset 选择；版本 5 加入原生 Claude Code 一次性委派事实。新的 DSH `spawn` 请求会在启动前捕获 profile 名称、有序 bundle，以及活动 Agent preset id 和模块名称。只有 bundle 列表与已发布模板完全一致时才标为稳定；只有所选 bundle 有明确实验性元数据时才标为实验性。没有明确产品分类时，preset 稳定性仍显示为不可用。自定义 profile patch 和运行时 overlay 不参与分类。原生 Codex 和 Claude Code 会将 DSH profile 与 preset 记录为不可用，因为 DSH 不管理其外部组合。这些标签不代表沙箱隔离、权限强制执行或 Skill 资格，后续配置变化也不会改写已保存快照。没有 profile 和 preset 快照的既有记录仍可读取，并显示为不可用。现有 `spawn` 行仍按原字段读取。`spawn` 请求会在启动前保存拟请求的子级 Session id；Codex 和 Claude Code 请求不会虚构 DSH Session 身份。拟请求的 `spawn` id 不代表已获准入。应用重启时，缺少后续事实的请求或 admission 会变为 `unconfirmed`，不会重新启动 activation。Codex 或 Claude Code 启动调用在 dispatch 开始后拒绝时也会变为 `unconfirmed`，因为外部运行可能已经启动；除非独立确认其未启动，否则不要重复任务。若 `spawn` 准入状态不确定，可用 `/activity sessions` 检查拟请求的 id；Session 记录缺失不能证明启动失败。外部准入会保存适配器的 `SubagentRun.id`，不是 DSH Session 或原生提供方会话 id。Activity 不为外部委派提供继续、恢复、对话记录检查或回滚。Codex 和 Claude Code 遵循各自的原生配置与权限处理。提供方输出只是报告，不代表验证或用户接受。`spawn` 子级权限由 DSH 运行时策略控制；Activity 范围不是授权约束。不涉及 Session 格式版本变更。

## 委派结果

提供方报告会保留提供方停止原因。Activity 视图仅分类已知的 subagent 原因：`completed`、`error`、`aborted`、`max-tokens` 和 `refusal`；未知原因仍显示为未知。可用时，视图会显示报告来源和观察时间，以及不确定状态的来源类别和观察时间。DSH 不会检查已保存报告的新鲜度，也不会查询提供方后续状态，因此报告新鲜度未知并可能已过时。缺少报告时，会根据已保存的生命周期事实显示为 pending 或 unconfirmed；打开 Activity 永远不会重试工作。

对于降级结果，打开 Activity 时会为待处理或不确定的启动显示检查提示。只有已保存事实支持新工作且所选提供方路由已注册时，才会提示用户单独、明确地发起新请求；路由注册不代表凭据可用、用户同意、原生权限或已获准入。Activity 不提供停止操作，外部一次性运行没有 Activity 状态查询、转录检查或恢复操作。未知结果会继续保持未解决状态，打开 Activity 不会启动或恢复执行。

## 上下文关联

独立的版本 1 `home_activity_associations` 域会在 Activity 记录之外保存用户选定的 Workspace 和 DSH Session id，每种引用最多 256 个。两类 id 分别选择；共享 Activity 不会把 Session 分配给 Workspace，也不会从 Workspace 目录推断 Git 仓库根目录。删除引用只修改关联记录，不会重写 Workspace 记录或 Session 日志。

打开 Activity 时，系统会通过各自的注册表解析 id。已删除的上下文会标记为不可用，直到用户主动解除关联。目录、注册表或持久化读取失败会显示为未知状态，而不会误报为引用不存在。

## 产物指针

独立的版本 1 `home_activity_artifacts` 域会保存用户关联的输出指针。每个指针关联到特定 Activity 委派和已关联到该 Activity 的 Workspace，并记录标签、用户提供的来源位置、可选来源修订版和记录时间。缺少修订版时会显示为未知。若委派属于其他 Activity，或 Workspace 尚未关联到该 Activity，服务会拒绝该指针。

产物指针不会修改委派请求、准入或报告。打开 Activity 时会分别显示委派发起 Session 与用户选择的 Workspace，并说明两者与报告输出的关系未经验证；Workspace 与 Session 关联始终相互独立。指针不会暗示共享 checkout、Git 根目录，也不会自动触发跨 Workspace 写入、合并或发布。

## 结果审核

独立的版本 1 `home_activity_reviews` 域会为每项委派保存一条用户审核记录，并关联到其所属 Activity。没有审核记录表示用户处置仍为 pending。只有委派的提供方报告已保存后，服务才接受审核记录。用户可以将当前处置设为 pending、accepted、declined 或 requires investigation，并追加分别注明来源的证据，记录用户填写的来源和报告结果。打开 Activity 时会将处置及各条证据与提供方报告分别显示。

证据及其结果由用户提供，DSH 不会检查。相互冲突的记录会分别显示，不会合并为单一验证状态。更新处置会保留证据，也不会修改委派请求、准入或报告。审核 Activity 不会启动或重试委派。

## 用户备注

独立的版本 1 home_activity_annotations 域会保存用户撰写的不可变 user-command 修订，并将每条修订关联到同一 Activity 的上一条修订。更正只更新当前协调备注，不会编辑 Activity 字段、提供方报告或专家断言。每个 Activity 最多保留 256 条修订；/activity open 显示当前备注和最近八条。备注文本不接受控制、格式、行分隔或段落分隔字符，以便历史记录保持单行。写入被拒绝后，持久化状态可能不确定；请重启 DSH 并检查已保存历史，再决定是否重试。

## 外部交接

独立的版本 1 `home_activity_handoffs` 域会保存用户提供的来源标签、可选摘要或来源引用、可选产物引用，以及记录交接时所在的 DSH Session。交接至少需要摘要、来源引用或产物引用之一。其他 DSH Session 打开 Activity 时，会将其显示为外部用户输入，而非原生执行历史。此服务不会导入 transcript、同步外部 Session，也不会声称所报告的工作已执行、验证或接受。

## 战略简报

独立的版本 1 `home_activity_strategic_episodes` 域会追加由 agent 撰写的建议性简报，不改变 Activity 意图、备注或委派事实。`/activity assess` 会加载现有 Sensemaking Skills 和明确选择的 Workspace；仓库读取使用现有只读协调工具，并须另行获得一次性批准。每条记录保留 Activity 目标、来源 Session、Workspace id、由协调工具报告的 Git 修订和观察时间、是否存在暂存、未暂存或未跟踪的来源文件、来源引用、已加载 Skill 内容摘要、发现、替代方案、不确定性，以及建议或不选择。记录器会将仓库 id 和来源元数据绑定到来源 Session 中匹配的成功协调器工具结果；但不会独立验证来源内容、引用或发现。来源不可用、存在未提交变更、观察期间变化或稳定性未知时，简报必须标为不完整。后续简报会取代建议，但保留早期记录。`/activity open` 显示最新简报，`/activity brief` 可检索指定的历史版本，不会重新读取仓库；后续保存的观察会让早期适用性变得不确定，没有后续观察时当前适用性仍未确认。`/activity assess cancel` 会阻止保存未完成简报，但不会停止已获准并正在运行的读取。

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
