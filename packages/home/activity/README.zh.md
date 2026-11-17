---
description: "独立于 agent Session 保存、列出并重新打开命名的用户 Activity，并记录独立的上下文引用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-home-activity

[English](README.md) | 中文

## 概述

保存命名 Activity、目标和描述性范围说明，使其在原 Session 结束后仍可使用。Web 和 SDK 的 /activity 命令可以分别关联用户选择的 Workspace 与 DSH Session 身份，并允许其他 Session 重新打开这些引用。单独的委派服务会记录用户明确请求的 DSH 原生子级 activation 及提供方报告；委派不会创建关联。创建或打开 Activity 不会执行其目标、创建 Goal 或授予运行时权限。

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

Activity 记录使用版本 1 的 `home_activities` StorageDomain，并继续独立于 Session、Goal 和 Workspace 记录。委派记录使用可读取版本 1 记录的版本 2 `home_activity_delegations` 域。由于版本 1 读取器无法识别新增的 Codex 记录，必须拒绝较新的版本戳，因此需要升级域版本。现有 `spawn` 行保留原字段；新的 `spawn` 请求会在启动前保存拟请求的子级 Session id，而 Codex 请求不会虚构 DSH Session 身份。Codex 准入会保存其提供方适配器的 `SubagentRun.id`，不是 DSH Session 或原生 Codex 线程 id。两种提供方之后都会分别记录准入和报告事实。拟请求的 `spawn` id 不代表已获准入。应用重启会将未完成记录改为 `unconfirmed`，且不会重新启动执行。Codex 启动调用在 dispatch 开始后拒绝时，记录会保持 `unconfirmed`，因为外部运行可能已经启动；除非独立确认 Codex 未启动，否则不要重复该任务。

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
| [`tests/activity.spec.ts`](tests/activity.spec.ts) | 存储关闭、重开与校验行为 |
| [`tests/delegations.spec.ts`](tests/delegations.spec.ts) | 委派事实持久化、重启恢复与校验 |
| [`tests/associations.spec.ts`](tests/associations.spec.ts) | 关联校验、重启恢复、幂等性与写入回滚 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Home Activity 子系统](../../../docs/subsystems/home-activity.zh.md) — 领域与持久化语义。
- [StorageDomain](../../storage/storage-domain/README.zh.md) — 带版本的主机端记录。
- [Web `/activity` 命令](../../interaction/command-home-activity/README.zh.md) — 创建、列出并打开 Activity。

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
- `spawn` 委派记录标识请求 Session 和已接受的子级 Session；Codex 记录单独保存外部执行 id，不会把它当成 DSH Session。两者都不会创建 Activity 与 Session 的关联，也不会提供可复用知识。
- 委派执行由单独的显式 `/activity delegate` 命令启动；Activity 服务本身没有编辑、删除或调度操作。原生 Codex 委派是一次性执行；Activity 不提供继续、恢复、对话记录检查或回滚，并遵循 Codex 原生配置与权限模式。提供方报告的输出不会被标记为已验证或已接受。

- Workspace 和 Session 引用由用户分别选择。Workspace id 表示已注册的 DSH Workspace 目录，而非推断出的仓库根目录；共享 Activity 不会把 Session 分配给 Workspace。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
