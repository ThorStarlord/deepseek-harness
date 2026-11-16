---
description: "独立于 agent Session 保存、列出并重新打开命名的用户 Activity。"
kind: "package-reference"
---

# @deepseek-ai/dsh-home-activity

[English](README.md) | 中文

## 概述

保存命名 Activity、目标和描述性范围说明，使其在原 Session 结束后仍可使用。单独的委派服务会记录用户明确请求的 DSH 原生子级 activation 及其提供方报告。创建或打开 Activity 不会执行其目标、创建 Goal、关联 Session，也不会授予运行时权限。

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

Web 配置会将此服务与 JSON StorageDomain 提供方及人工调用的 `/activity` 命令一同加载。

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
```

存储提供方拥有各自的设置；请参阅 [JSON 后端](../../storage/storage-json/README.zh.md)和 [StorageDomain](../../storage/storage-domain/README.zh.md)参考。

启用委派的组合还需挂载 `@deepseek-ai/dsh-home-activity/delegations`、`@deepseek-ai/dsh-subagent` 和命令支持的 DSH 原生提供方。Web 配置包含 `spawn` 提供方。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

Activity 记录使用版本 1 的 `home_activities` StorageDomain，并继续独立于 Session、Goal 和 Workspace 记录。委派记录使用单独的版本 1 `home_activity_delegations` 域；每个请求都会在启动前保存拟请求的子级 Session id，之后再分别记录准入和报告事实。拟请求的 id 不代表已获准入。应用重启会将未完成记录改为 `unconfirmed`，且不会重新启动子任务。

| 文件 | 职责 |
|---|---|
| [`src/types.ts`](src/types.ts) | Activity 身份与请求类型 |
| [`src/spec.ts`](src/spec.ts) | 带版本的持久化记录 schema |
| [`src/index.ts`](src/index.ts) | Activity 目录服务 |
| [`src/delegation-types.ts`](src/delegation-types.ts) | 委派生命周期事实类型 |
| [`src/delegation-spec.ts`](src/delegation-spec.ts) | 带版本的委派记录 schema |
| [`src/delegations.ts`](src/delegations.ts) | 独立委派 StorageDomain 服务 |
| [`tests/activity.spec.ts`](tests/activity.spec.ts) | 存储关闭、重开与校验行为 |
| [`tests/delegations.spec.ts`](tests/delegations.spec.ts) | 委派事实持久化、重启恢复与校验 |

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
- 委派记录标识请求 Session 和已接受的子级 Session，但不会创建 Activity 与 Session 的关联，也不会提供可复用知识。
- 委派执行由单独的显式 `/activity delegate` 命令启动；Activity 服务本身没有编辑、删除或调度操作。提供方报告的输出不会被标记为已验证或已接受。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
