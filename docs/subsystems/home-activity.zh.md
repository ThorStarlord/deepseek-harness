# Home Activity

[English](home-activity.md) | 中文

Home Activity 是由用户发起并持久保存的事务，包含稳定身份、名称、目标、描述性范围说明和创建时间。它独立于任何 Session；创建或打开 Activity 不会启动其目标。`home-activity` 包通过 [StorageDomain](storage.zh.md) 保存 Activity 记录，明确委派的记录则保存在单独的 sidecar 中。Web [`/activity` 命令](../../packages/interaction/command-home-activity/README.zh.md) 可创建、列出、打开并明确委派一项有界任务。

## 已保存意图

`ActivityId` 是生成的 UUID。`ActivityBoundaries.inScope` 和 `outOfScope` 是用户撰写的描述，不会更改 sandbox 根目录、工具策略或仓库访问权限。打开 Activity 会显示已保存意图和单独记录的委派。Activity 记录本身没有状态、Session 关联、执行或继续执行语义。

`home_activities` 域使用格式版本 1。单独的版本 1 `home_activity_delegations` 域会在启动前保存用户请求和拟请求的子级 Session id，之后再分别保存 DSH 准入和提供方报告事实。拟请求的 id 不代表已获准入。应用重启时，缺少后续事实的请求或 admission 会变为 `unconfirmed`；不会重新启动 activation。若准入状态不确定，可用 `/activity sessions` 检查拟请求的 id；Session 记录缺失不能证明启动失败。提供方输出只是报告，不代表验证或用户接受。子级权限由 DSH 运行时策略控制；Activity 范围不是授权约束。不涉及 Session 格式版本变更。

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
<!-- END GENERATED cordis-surface -->
