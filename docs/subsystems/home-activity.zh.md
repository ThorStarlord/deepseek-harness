# Home Activity

[English](home-activity.md) | 中文

Activity 意图持久保存，且独立于写入时所在的 Session。它包含稳定身份、名称、目标、描述性范围说明和创建时间；不会创建 Goal、Workflow、Workspace project 或执行。`home-activity` 包通过共享的 [StorageDomain](storage.zh.md) 表单保存意图。Web [`/activity` 命令](../../packages/interaction/command-home-activity/README.zh.md)可创建、列出、打开和关联 Activity。

## 已保存意图

`ActivityId` 是生成的 UUID。`ActivityBoundaries.inScope` 和 `outOfScope` 是用户撰写的描述，不会更改 sandbox 根目录、工具策略或仓库访问权限。打开 Activity 只显示已保存意图和单独保存的引用；不会启动执行或激活 Goal。

`home_activities` 域使用格式版本 1，并保持原有严格记录不变。schema 要求名称和目标非空、至少一条范围内说明、每个列表最多 20 条说明，并限制文本长度。无效的已存记录会导致域打开失败。不涉及 Session 格式版本变更。

## 上下文引用

附加的 `home_activity_associations` 版本 1 域将 Workspace 和 DSH Session id 与 Activity 意图分开保存，每个 Activity 的每种引用最多 256 项。服务会在写入前拒绝超出上限的关联；用户可以移除现有引用后重试。用户分别选择每个引用；Session 引用不会仅因共用 Activity 而被分配到某个 Workspace。Workspace id 指向已注册的 DSH Workspace 目录，不推断 Git 仓库根目录。移除或更正引用只会更改此关联记录，不会修改 Workspace 记录或 Session 日志。

打开 Activity 时会从各自的注册表解析已保存 id。已移除的 Workspace 或 Session 仍会显示为不可用，直到用户明确取消关联。注册表或存储读取失败会显示错误，不会被当作引用缺失。

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
<!-- END GENERATED cordis-surface -->
