---
description: "独立于 agent Session 保存、列出并重新打开命名的用户 Activity，并记录独立的上下文引用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-home-activity

[English](README.md) | 中文

## 概述

保存包含目标和描述性边界的命名 Activity，即使原 Session 已结束仍可继续使用。Web 和 SDK `/activity` 命令可关联所选 Workspace 与 DSH Session 身份，其他 Session 可重新打开这些引用。独立服务分别保存委派事实、用户关联的产物指针，以及带来源归属验证证据的用户处置；审核记录不会覆盖提供方报告。委派记录保存用户明确请求的 DSH 原生子级执行或一次性 Codex 运行，以及提供方报告的结果，但不会创建关联。创建或打开 Activity 不会执行其目标、创建 Goal 或授予运行时权限。


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

Web 和 SDK 配置会将此服务、关联服务、JSON StorageDomain 提供方及人工调用的 `/activity` 命令一同加载。

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
```

存储提供方拥有各自的设置；请参阅 [JSON 后端](../../storage/storage-json/README.zh.md)和 [StorageDomain](../../storage/storage-domain/README.zh.md)参考。

启用委派的组合还需挂载 `@deepseek-ai/dsh-home-activity/delegations`、`@deepseek-ai/dsh-subagent` 和命令支持的提供方。Web 配置包含 `spawn`；启用可选的原生 Codex 提供方后，也可选择 `codex`。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

Activity 记录使用版本 1 的 `home_activities` StorageDomain，并继续独立于 Session、Goal 和 Workspace 记录。委派记录使用版本 3 `home_activity_delegations` 域，可读取版本 1 和版本 2 记录。版本 3 必要，因为版本 2 的严格不确定原因枚举无法识别新的 Codex 启动结果；旧读取器会拒绝较新的版本戳。现有 `spawn` 行保留原字段；新的 `spawn` 请求会在启动前保存拟请求的子级 Session id，而 Codex 请求不会虚构 DSH Session 身份。Codex 准入会保存其提供方适配器的 `SubagentRun.id`，不是 DSH Session 或原生 Codex 线程 id。两种提供方之后都会分别记录准入和报告事实。拟请求的 `spawn` id 不代表已获准入。应用重启会将未完成记录改为 `unconfirmed`，且不会重新启动执行。`PROVIDER_CHANGED` 失败会在调用提供方前发生，并记录为未获准入；Codex 启动调用在提供方调用开始后拒绝时，记录会保持 `unconfirmed`，因为外部运行可能已经启动。 外部启动在调用提供方前失败时会以 `NOT_DISPATCHED` 拒绝，并记录为未获准入。除非独立确认任务未启动，否则不要重复未确认的任务。

Workspace 和 DSH Session 引用保存在独立的版本 1 `home_activity_associations` 域中。显示时会通过各自的注册表解析引用；过期引用会明确显示为不可用，直到用户解除关联。关联不会修改 Workspace 记录、Session 日志或 Activity 记录。

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

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Home Activity 子系统](../../../docs/subsystems/home-activity.zh.md) — 领域与持久化语义。
- [StorageDomain](../../storage/storage-domain/README.zh.md) — 带版本的主机端记录。
- [Web `/activity` 命令](../../interaction/command-home-activity/README.zh.md) — 创建、列出、打开并审核 Activity。

-----

<a id="model-experience"></a>
## 模型体验

无此类模型体验，因为此服务仅持久化 Activity 记录，不会增加模型上下文或工具。

#### KV 缓存影响

无；创建或打开 Activity 不会增加模型输入。委派子级 Session 会自行发起 provider 请求。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

Activity 范围仍是描述性内容；委派不会将其作为授权规则执行。

- 边界是描述性陈述，不是沙箱根目录或权限授予。
- 委派记录标识请求方 Session 和获准入的子级 Session，但不会创建 Activity 与 Session 的关联或可复用知识。
- Workspace 和 Session 引用由用户分别选择。Workspace id 表示已注册的 DSH Workspace 目录，而非推断出的仓库根目录；共享 Activity 不会把 Session 分配给 Workspace。
- 委派执行必须通过单独的显式 `/activity delegate` 命令启动；Activity 服务本身没有编辑、删除或调度操作。DSH 不会独立验证提供方报告，也不会由报告决定用户的单独处置。原生 Codex 委派为一次性操作，Activity 不提供继续、恢复、查看转录或回滚功能；执行遵循 Codex 原生配置和权限模式。
- 产物引用只是用户关联的指针；它不会复制或检查输出、证明生成者、验证内容，也不会触发跨 Workspace 写入、合并或发布。缺少来源修订版时仍显示为未知。
- 审核证据及其报告结果由用户提供。DSH 会保留其来源信息，但不会检查来源、证据或结果；当前处置与提供方执行状态分开保存。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
