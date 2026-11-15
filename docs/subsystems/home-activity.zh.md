# Home Activity

[English](home-activity.md) | 中文

Home Activity 是由用户发起并持久保存的事务，包含稳定身份、名称、目标、描述性范围说明和创建时间。它独立于任何 Session，不会创建 Goal、Workflow、Workspace 项目或执行任务。`home-activity` 包通过共享的 [StorageDomain](storage.zh.md) 表单保存记录。Web [`/activity` 命令](../../packages/interaction/command-home-activity/README.zh.md) 可创建、列出和打开记录。

## 已保存意图

`ActivityId` 是生成的 UUID。`ActivityBoundaries.inScope` 和 `outOfScope` 是用户撰写的描述，不会更改 sandbox 根目录、工具策略或仓库访问权限。打开 Activity 只会显示已保存意图。此初始记录没有状态、Session 关联、执行或继续执行语义。

`home_activities` 域使用格式版本 1。schema 要求名称和目标非空、至少一条范围内说明、每个列表最多 20 条说明，并限制文本长度。无效的已存记录会导致域打开失败。不涉及 Session 格式版本变更。

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
<!-- END GENERATED cordis-surface -->
