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

启用委派的组合还需挂载 `@deepseek-ai/dsh-home-activity/delegations`、`@deepseek-ai/dsh-subagent` 和受支持的提供方。命令支持 `spawn`；启用可选的原生 Codex 或 Claude Code 提供方后，也支持 `codex` 和 `claude-code`。

### 命令参考

| 命令 | 行为 |
|---|---|
| `/activity create <JSON>` | 保存名称、目标，以及包含 `inScope` 和 `outOfScope` 字符串数组的 `boundaries` 对象。至少需要一项 `inScope` 内容。 |
| `/activity list` | 按创建时间从新到旧列出已保存 Activity 的名称和稳定 id。 |
| `/activity open <activity-id>` | 显示已保存目标、描述性边界、上下文引用、委派记录和捕获的 profile 和 preset 选择。 |
| `/activity workspaces` | 列出可以关联的注册 Workspace 上下文。 |
| `/activity sessions` | 列出已存储的 DSH Session 及可用摘要元数据。 |
| `/activity link <activity-id> workspace <workspace-id>` | 添加 Workspace 引用，不修改 Workspace 记录。 |
| `/activity link <activity-id> session <session-id>` | 添加 DSH Session 引用，不修改 Session 日志。 |
| `/activity unlink <activity-id> workspace <workspace-id>` | 删除 Workspace 引用，保留源记录。 |
| `/activity unlink <activity-id> session <session-id>` | 删除 DSH Session 引用，保留 Session 日志。 |
| `/activity artifact add <activity-id> <delegation-id> <workspace-id> <JSON>` | 为该 Activity 的委派记录输出指针，并要求所选 Workspace 已关联到同一 Activity。JSON 字段为 `label`、`location` 和可选的 `revision`；缺少修订版时显示为未知。 |
| `/activity delegate <activity-id> spawn <task>` | 保存请求，明确启动一个 DSH 原生子级 Session，并单独报告提供方结果。 |
| `/activity delegate <activity-id> codex <task>` | 保存请求，明确启动一次原生 Codex 执行，并单独报告结果。它是一次性执行，不会创建 DSH Session。任务最多为 4,096 个 UTF-8 字节。 |
| `/activity delegate <activity-id> claude-code <task>` | 保存请求，明确启动一次原生 Claude Code 执行，并单独报告结果。它是一次性执行，不会创建 DSH Session。任务最多为 4,096 个 UTF-8 字节。 |

创建和产物 JSON 最多为 16,384 个 UTF-8 字节。每个 Activity 最多可关联 256 个 Workspace、256 个 DSH Session 和 512 个产物指针。`spawn` 请求和拟请求子级 Session id 会在提供方启动前持久化；该 id 不证明已获准入。Codex 和 Claude Code 请求不会虚构 DSH Session id。命令会在 DSH 接受 activation 后返回，结果记录独立继续。外部提供方不可用时会在 dispatch 前记录为未获准入。若 Codex 或 Claude Code 启动调用在 dispatch 开始后拒绝，记录会保持 `unconfirmed`，因为外部运行可能已经启动；除非独立确认其未启动，否则不要重复任务。打开 Activity 不会重试。若 `spawn` 准入状态不确定，`/activity sessions` 会显示拟议 id 是否对应已存储 Session 及其可用摘要元数据；该命令不会读取对话记录。未找到 Session 不能证明启动失败。外部准入会记录适配器的 `SubagentRun.id`，不是 DSH Session 或原生提供方会话 id；Activity 不提供继续、恢复、对话记录检查或回滚。Codex 和 Claude Code 遵循各自的原生配置与权限处理，Activity 范围仍仅作描述。提供方输出按原样报告，不会标为已验证或已接受。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

此命令供用户明确调用，而非模型工具。创建、列出和打开通过 `ctx.homeActivities` 执行；上下文引用通过 `ctx.homeActivityAssociations` 执行；委派使用现有 `ctx.subagents.startActivation` 生命周期和单独的持久记录。DSH `spawn` 会在启动前捕获启动器的 profile bundle 选择和活动 Agent preset 模块。Codex 和 Claude Code 的 profile 与 preset 信息会记录为不可用，因为 DSH 无法查看其外部运行时组合。此命令不会创建 Goal，也不会声称提供方报告已经过验证或接受。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 命令注册、输入校验与用户可见结果 |
| [`src/delegation-command.ts`](src/delegation-command.ts) | 委派解析、生命周期与用户可见结果 |
| [`src/execution-selection.ts`](src/execution-selection.ts) | DSH profile 和 preset 快照及保守的产品分类 |
| [`src/association-command.ts`](src/association-command.ts) | Workspace 和 Session 目录、引用命令与解析 |
| [`src/artifact-command.ts`](src/artifact-command.ts) | 用户关联的产物指针命令与显示 |
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

Activity 范围说明描述请求的工作，不会更改提供方权限。`spawn` 由 DSH 运行时策略控制；Codex 和 Claude Code 分别由其原生配置和权限处理控制。

- Web composer 与 SDK session.run() 是受支持的交互界面；没有独立 Activity 浏览器或原生 Desktop 命令。SDK profile 必须加载 Home Activity 插件。
- 创建输入使用 JSON 文本，且无法通过此命令编辑或删除 Activity。Codex 和 Claude Code 委派均为一次性执行；Activity 不提供继续、恢复、对话记录检查或回滚。Session 列表仅提供摘要元数据，不会读取子级对话，也不能证明提供方已准入。
- 产品分类只使用捕获的 bundle 列表或活动 preset 模块及产品提供的元数据。自定义 profile patch 和运行时 overlay 不参与分类；只有与已发布 profile 模板完全一致时，bundle 列表才标为稳定；没有明确分类的 preset 会显示为不可用。这些标签不代表沙箱隔离、权限强制执行或 Skill 资格。
- 产物位置、修订版和 Workspace 选择由用户提供。命令不会检查被引用的文件，也不会从 Workspace 目录推断 Git 根目录；缺少的修订版保持未知，指针不验证执行上下文或提供方输出。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
