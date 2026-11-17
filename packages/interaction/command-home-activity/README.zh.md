---
description: "在 Web composer 或 SDK session.run() 中创建、列出、重新打开、关联并显式委派已保存的 Home Activity。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-home-activity

[English](README.md) | 中文

## 概述

在 Web composer 或 SDK session.run() 中使用 /activity 创建带有目标和描述性范围的命名 Activity，列出并重新打开已保存的 Activity，分别关联或解除用户选择的 Workspace 与 DSH Session 身份，并显式委派一个有界任务给 DSH 原生 spawn 提供方。Activity 目标不会自动执行；委派仅启动用户请求的子级任务，并单独记录 DSH 报告的结果。此命令需要命令注册表、Activity、关联与委派服务、Workspace 注册表、Session 持久化和 subagent 服务。
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

Web 和 SDK profile 会通过命令注册表、持久化 Activity 与关联服务、Workspace 注册表及 Session 持久化服务加载此命令。启用委派还需要 Activity 委派与 subagent 服务，以及受支持的 DSH 原生提供方。

### 何时选择

当用户需要为后续对话保存意图时，使用 `/activity`。当前 Session 的完成目标使用 `/goal`；Activity 不会启动或激活 Goal。

### 最小配置

在已提供命令注册、Activity、上下文关联和委派所需服务的组合中，添加此插件：

```yaml
- name: '@deepseek-ai/dsh-command-home-activity'
```

[命令注册表](../commands/README.zh.md)负责直接调用人工命令，[`dsh-home-activity`](../../home/activity/README.zh.md)负责持久记录。

启用委派的组合还需挂载 `@deepseek-ai/dsh-home-activity/delegations`、`@deepseek-ai/dsh-subagent` 和受支持的提供方。命令支持 `spawn`；启用可选的原生 Codex 提供方后也支持 `codex`。

### 命令参考

| 命令 | 行为 |
|---|---|
| `/activity create <JSON>` | 保存名称、目标，以及包含 `inScope` 和 `outOfScope` 字符串数组的 `boundaries` 对象。至少需要一项 `inScope` 内容。 |
| `/activity list` | 按创建时间从新到旧列出已保存 Activity 的名称和稳定 id。 |
| `/activity open <activity-id>` | 显示已保存目标、描述性边界和委派记录。 |
| `/activity workspaces` | 列出可以关联的注册 Workspace 上下文。 |
| `/activity sessions` | 列出已存储的 DSH Session 及可用摘要元数据。 |
| `/activity link <activity-id> workspace <workspace-id>` | 添加 Workspace 引用，不修改 Workspace 记录。 |
| `/activity link <activity-id> session <session-id>` | 添加 DSH Session 引用，不修改 Session 日志。 |
| `/activity unlink <activity-id> workspace <workspace-id>` | 删除 Workspace 引用，保留源记录。 |
| `/activity unlink <activity-id> session <session-id>` | 删除 DSH Session 引用，保留 Session 日志。 |
| `/activity delegate <activity-id> spawn <task>` | 保存请求，明确启动一个 DSH 原生子级 Session，并单独报告提供方结果。 |
| `/activity delegate <activity-id> codex <task>` | 保存请求，明确启动一次原生 Codex 执行，并单独报告结果。它是一次性执行，不会创建 DSH Session。任务最多为 4,096 个 UTF-8 字节。 |

`spawn` 请求和拟请求子级 Session id 会在提供方启动前持久化；该 id 不证明已获准入。Codex 请求不会虚构 DSH Session id。若 `spawn` 准入状态不确定，`/activity sessions` 会显示拟议 id 是否对应已存储 Session 及其可用摘要元数据；该命令不会读取对话记录。未找到 Session 不能证明启动失败。Codex 准入事实会记录其适配器的 `SubagentRun.id`，不是 DSH Session 或原生 Codex 线程 id；Activity 不提供继续、恢复、对话记录检查或回滚。Codex 使用其原生配置与权限模式，Activity 范围仍仅作描述。提供方输出仍按原样报告，不会标为已验证或已接受。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

此命令供用户明确调用，而非模型工具。创建、列出和打开通过 `ctx.homeActivities` 执行；委派使用现有 `ctx.subagents.startActivation` 生命周期和单独的持久记录。此命令不会创建 Goal，也不会声称提供方报告已经过验证或接受。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 命令注册、输入校验与用户可见结果 |
| [`src/delegation-command.ts`](src/delegation-command.ts) | 委派解析、生命周期与用户可见结果 |
| [`src/association-command.ts`](src/association-command.ts) | Workspace 和 Session 目录、引用命令与解析 |
| [`tests/command.spec.ts`](tests/command.spec.ts) | 命令行为、安全失败与不执行断言 |
| [`tests/delegation.e2e.spec.ts`](tests/delegation.e2e.spec.ts) | 通过宿主调用路径验证提供方委派成功与失败 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Home Activity 服务](../../home/activity/README.zh.md) — 持久身份与已保存意图。
- [人工命令注册表](../commands/README.zh.md) — 命令注册与调用。
- [Home Activity 子系统](../../../docs/subsystems/home-activity.zh.md) — 领域与持久化语义。

-----

<a id="model-experience"></a>
## 模型体验

模型体验通过显式的 `/activity delegate` 命令间接产生：该命令会通过所选提供方启动一次执行，并分别记录请求、DSH 准入和提供方报告，不会暗示结果已验证或被用户接受。

#### KV 缓存影响

无；委派任务独立于父级上下文运行。只有 `spawn` 会创建 DSH 子级 Session。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

Activity 范围说明描述请求的工作；它们不会更改提供方权限。`spawn` 由 DSH 运行时策略控制；`codex` 由 Codex 原生配置和指定权限模式控制。

- Web composer 与 SDK session.run() 是受支持的交互界面；没有独立 Activity 浏览器或原生 Desktop 命令。SDK profile 必须加载 Home Activity 插件。
- 创建输入使用 JSON 文本，且无法通过此命令编辑或删除 Activity。Codex 委派仅执行一次；Activity 不提供继续、恢复、对话记录检查或回滚。Session 列表仅提供摘要元数据；它不会读取子级对话，也不能证明提供方已准入。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
