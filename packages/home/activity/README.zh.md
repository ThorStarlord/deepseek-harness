---
description: "独立于 agent Session 保存、列出并重新打开命名的用户 Activity，并记录独立的上下文引用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-home-activity

[English](README.md) | 中文

## 概述

保存命名 Activity、目标和描述性范围，使其可跨 Session 使用。Web 与 SDK 的 `/activity` 命令可在不同 Session 中重新打开 Activity，并记录所选 Workspace、Session、备注、委派、报告、交接和审核。显式运行 `/activity assess` 可保存建议性战略简报，以供后续 Session 查看。创建或打开 Activity 不会开始工作、激活 Goal 或授予权限；外部交接不会变成 DSH 原生执行记录。


## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

Web 和 SDK 配置会将此服务、关联与备注服务、JSON StorageDomain 提供方及人工调用的 `/activity` 命令一同加载。

### 何时选择

当用户发起的事务需要独立于 Session 的稳定身份和已保存意图时，选择 Activity。交互历史使用 Session，同一 Session 内的完成跟踪使用 Goal，目录分组使用 Workspace project。

### 最小配置

此服务没有配置字段。自定义组合需先提供现有存储栈，再挂载此服务：

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
  config:
    root: /var/lib/dsh/storages
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-home-activity'
- name: '@deepseek-ai/dsh-home-activity/associations'
- name: '@deepseek-ai/dsh-home-activity/annotations'
- name: '@deepseek-ai/dsh-home-activity/strategic-episodes'
- name: '@deepseek-ai/dsh-home-activity/handoffs'
```

存储提供方拥有各自的设置；请参阅 [JSON 后端](../../storage/storage-json/README.zh.md)和 [StorageDomain](../../storage/storage-domain/README.zh.md)参考。

启用委派的组合还需挂载 `@deepseek-ai/dsh-home-activity/delegations`、`@deepseek-ai/dsh-subagent` 和命令支持的提供方。Web 配置包含 `spawn`；启用可选的原生 Codex 或 Claude Code 提供方后，也可选择 `codex` 或 `claude-code`。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

Activity 记录使用版本 1 的 home_activities StorageDomain，并保持独立于 Session、Goal 和 Workspace 记录。委派使用独立的版本 5 home_activity_delegations 域，可读取版本 1 至 4 的记录。版本 3 首次加入 Codex 启动结果，严格的版本 2 读取器无法识别该结果；版本 4 会记录启动时选择的 profile 和 preset；版本 5 加入原生 Claude Code 一次性委派事实。没有 profile 和 preset 快照的旧记录仍可读取，并会将这些信息显示为不可用。新的 DSH spawn 请求会在启动前保存 profile 名称、有序的启动 bundle 列表、活动 Agent preset id 和模块名称。只有 bundle 列表与已发布 profile 模板完全相同时才标记为稳定；只有产品明确将所选 bundle 或模块标记为实验性时才标记为实验性；没有明确产品分类时，preset 稳定性保持不可用。bundle 分类不包含 profile patch 和运行时 overlay。原生 Codex 和 Claude Code 请求会将 profile 和 preset 显示为不可用，因为 DSH 无法查看外部运行环境。这些分类不证明沙箱隔离、权限强制执行或 Skill 资格；后续配置变化不会改写保存的 profile 和 preset 快照。现有 spawn 行保留原字段；新的 spawn 请求会在启动前保存拟用的子级 Session id，而 Codex 和 Claude Code 请求不会虚构 DSH Session 身份。外部准入会保存提供方适配器的一次性 SubagentRun.id，不是 DSH Session 或原生提供方对话 id。每种提供方分别保存准入和报告事实。拟用 spawn id 不证明已准入。应用重启会将未完成记录改为 unconfirmed，且不会重新启动执行。PROVIDER_CHANGED 和 NOT_DISPATCHED 类型失败发生在调用提供方之前，并记录为未准入；Codex 或 Claude Code 启动调用在开始调用提供方后拒绝时，会记录为 unconfirmed，因为外部运行可能已经启动。除非独立确认任务没有启动，否则不要重复未确认的任务。

用户更正保存在独立的版本 1 `home_activity_annotations` 域中。每条不可变的 `user-command` 修订只会替代同一 Activity 的上一条备注，不会修改 Activity 或委派记录；每个 Activity 最多保留 256 条修订。备注文本不接受控制、格式、行分隔或段落分隔字符，以便显示的历史保持单行。

战略简报保存在独立、只追加的版本 1 `home_activity_strategic_episodes` 域中。记录保留 Activity 目标、来源 DSH Session、明确选择的 Workspace id、agent 撰写的发现与替代方案、仓库相对来源引用、协调器报告的 Git 修订和观察时间、已跟踪及未忽略工作文件是否包含暂存、未暂存或未跟踪变更、已加载 Sensemaking Skill 内容摘要、不确定性以及建议或明确的不选择。记录器会将仓库身份和来源元数据绑定到来源 Session 中匹配的成功协调器工具结果；但不会独立验证仓库内容或发现。若选定的 Workspace 不可用、存在未提交来源变更、观察期间发生变化或来源稳定性未知，简报必须标为不完整。同一请求 id 的重复记录调用会返回已有记录；后续评估会追加新的后继记录并保留旧来源历史。打开 Activity 显示最新简报；`/activity brief <activity-id> <revision>` 可打开更早的版本，且不会检查当前仓库或重复执行评估。

Workspace 和 DSH Session 引用保存在独立的版本 1 `home_activity_associations` 域中。显示时会通过各自的注册表解析引用；过期引用会明确显示为不可用，直到用户解除关联。关联不会修改 Workspace 记录、Session 日志或 Activity 记录。

用户提供的外部交接保存在独立的版本 1 `home_activity_handoffs` 域中。每条记录属于一个现有 Activity，并保存来源标签、可选的用户摘要或来源引用、用户提供的产物引用，以及记录时所在的 DSH Session。所有文本都会去除首尾空白并限制长度，且必须为单行；控制、格式、行分隔和段落分隔字符会被拒绝。其他 Session 打开 Activity 时，这些引用会显示为外部用户输入，而非导入的原生执行历史。此服务不会导入 transcript、同步外部 Session、确认工作执行者，也不会声称结果已验证或接受。

| 文件 | 职责 |
|---|---|
| [`src/types.ts`](src/types.ts) | Activity 身份与请求类型 |
| [`src/spec.ts`](src/spec.ts) | 带版本的持久化记录 schema |
| [`src/index.ts`](src/index.ts) | Activity 目录服务 |
| [`src/delegation-types.ts`](src/delegation-types.ts) | 委派生命周期事实类型 |
| [`src/delegation-spec.ts`](src/delegation-spec.ts) | 带版本的委派记录 schema |
| [`src/delegations.ts`](src/delegations.ts) | 独立委派 StorageDomain 服务 |
| [`src/association-types.ts`](src/association-types.ts) | Workspace 和 Session 引用类型 |
| [`src/association-spec.ts`](src/association-spec.ts) | 版本化关联记录 schema |
| [`src/associations.ts`](src/associations.ts) | 独立关联 StorageDomain 服务 |
| [`src/annotation-types.ts`](src/annotation-types.ts) | 用户撰写的备注修订类型 |
| [`src/annotation-spec.ts`](src/annotation-spec.ts) | 版本化备注记录 schema 和域 |
| [`src/annotations.ts`](src/annotations.ts) | 独立追加式备注 StorageDomain 服务 |
| [`src/strategic-episode-types.ts`](src/strategic-episode-types.ts) | 战略记录与证据引用类型 |
| [`src/strategic-episode-spec.ts`](src/strategic-episode-spec.ts) | 带版本的战略记录 schema 与域 |
| [`src/strategic-episodes.ts`](src/strategic-episodes.ts) | 追加式 Activity Strategic Brief 持久化服务 |
| [`src/handoff-types.ts`](src/handoff-types.ts) | 外部交接记录类型 |
| [`src/handoff-spec.ts`](src/handoff-spec.ts) | 带版本的外部交接 schema |
| [`src/handoffs.ts`](src/handoffs.ts) | 独立外部交接 StorageDomain 服务 |
| [`tests/handoffs.spec.ts`](tests/handoffs.spec.ts) | 外部交接校验及存储上下文重建后的持久化 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Home Activity 子系统](../../../docs/subsystems/home-activity.zh.md) — 领域与持久化语义。
- [StorageDomain](../../storage/storage-domain/README.zh.md) — 带版本的主机端记录。
- [Web `/activity` 命令](../../interaction/command-home-activity/README.zh.md) — 创建、列出、打开、添加备注并审核 Activity。

-----

<a id="model-experience"></a>
## 模型体验

此包只向应用提供持久化服务，不会添加模型指令或工具。

#### KV 缓存影响

Activity 持久化本身不会增加模型输入；显式命令可按 `command-home-activity` 文档所述将所选记录加入当前 Session。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

Activity 范围仍是描述性内容；委派不会将其作为授权规则执行。

- 边界是描述性陈述，不是沙箱根目录或权限授予。
- 委派记录标识请求方 Session 和获准入的执行；只有 `spawn` 会创建 DSH 子级 Session。委派不会创建 Activity 与 Session 的关联或可复用知识。
- Workspace 和 Session 引用由用户分别选择。Workspace id 表示已注册的 DSH Workspace 目录，而非推断出的仓库根目录；共享 Activity 不会把 Session 分配给 Workspace。
- 用户更正会在独立的版本 1 域中追加不可变备注修订；每个 Activity 最多保留 256 条，`/activity open` 显示最近 8 条并保留更早修订。
- 委派执行必须通过单独的显式 `/activity delegate` 命令启动；Activity 服务本身没有编辑、删除或调度操作。DSH 不会独立验证提供方报告，也不会由报告决定用户的单独处置。原生 Codex 和 Claude Code 委派均为一次性操作，Activity 不提供继续、恢复、查看转录或回滚功能；每种执行均遵循其原生配置和权限处理。
- Activity 视图仅分类已知的提供方停止原因；未知值仍显示为未知。可用时，视图会显示已保存报告的来源和时间，以及不确定状态的来源类别和观察时间。DSH 不会检查已保存报告的新鲜度，因此报告可能已过时；打开 Activity 不会查询提供方后续状态，也不会重试工作。
- 产物引用只是用户关联的指针；它不会复制或检查输出、证明生成者、验证内容，也不会触发跨 Workspace 写入、合并或发布。缺少来源修订版时仍显示为未知。
- 审核证据及其报告结果由用户提供。DSH 会保留其来源信息，但不会检查来源、证据或结果；当前处置与提供方执行状态分开保存。
- 战略记录是 agent 撰写的报告，不是独立验证或用户接受。评估要求两个 Sensemaking Skills 均可加载，并限制为恰好两个已注册 Workspace，因为现有协调工具支持两个仓库。记录器会将仓库 id、`HEAD` 修订、观察时间和工作树干净状态元数据绑定到来源 Session 中匹配的成功协调器结果，但不会独立验证来源内容、引用或发现。对于有未提交变更的来源，`HEAD` 只表示已提交的基准，简报不会保存暂存区或工作树文件内容。来源不可用、存在未提交变更、观察期间变化或稳定性未知时，简报必须标为不完整。`/activity open` 显示最新简报，`/activity brief` 可检索更早保存的版本；两者都不会检查当前仓库。

备注写入错误无法确认修订是否已经持久化。JSON 后端可能在替换文件后才报错，因此请先关闭并重新打开后端和域，再检查 Activity 并决定是否重试；此备注服务不承诺持久回滚。详见 [StorageDomain](../../storage/storage-domain/README.zh.md) 和 [JSON 后端](../../storage/storage-json/README.zh.md)的失败约定。

- 外部交接由用户通过 `/activity handoff add` 输入；不会导入 transcript 或同步外部 agent。来源标签、摘要和产物引用均由用户提供，未经独立验证或接受。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
