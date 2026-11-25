---
description: "在 Web composer 或 SDK session.run() 中创建、列出、重新打开、关联并显式委派或继续已保存的 Home Activity。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-home-activity

[English](README.md) | 中文

## 概述

通过 Web 或 SDK `session.run()` 中的 `/activity` 管理已保存的 Activity，并显式请求基于来源的战略简报或有界委派。评估会加载现有 Sensemaking Skills，并且只有经过单独批准后才会读取所选仓库。打开已保存简报不会重新运行评估。已接收分配提示的目标 DSH Session 可以追加有界、带来源归属的进展报告；这些报告仍是自我报告，不代表任务完成。委派会将提供方报告与验证和用户接受分开记录；Codex 与 Claude Code 保留原生身份验证和一次性执行行为。

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

Web 和 SDK profile 会通过命令注册表、工具注册表、持久化 Activity、关联、备注和战略记录服务、Workspace 注册表及 Session 持久化服务加载此命令。战略评估还要求活动 Agent 的 DSH Skill registry 提供 `using-sensemaking` 和 `multi-repository-strategic-analysis`，并挂载现有只读多仓库工具。如果 profile 未挂载协调器，或 Agent 的工具限制排除了它，DSH 会在加载 Skills 或启用请求守卫前拒绝评估，不会读取仓库。请参阅[多仓库协调器](../../workspace/tool-multi-repository/README.zh.md)了解其批准与访问模型。启用委派还需要 Activity 委派与 subagent 服务，以及受支持的 DSH 原生提供方。

### 何时选择

当用户需要为后续对话保存意图时，使用 `/activity`。当前 Session 的完成目标使用 `/goal`；Activity 不会启动或激活 Goal。

### 最小配置

在已提供命令注册、Activity、上下文关联和委派所需服务的组合中，添加此插件：

```yaml
- name: '@deepseek-ai/dsh-command-home-activity'
```

[命令注册表](../commands/README.zh.md)负责直接调用人工命令，[`dsh-home-activity`](../../home/activity/README.zh.md)负责持久记录。挂载 `@deepseek-ai/dsh-home-activity/handoffs` 可记录用户提供的外部交接。

启用委派的组合还需挂载 `@deepseek-ai/dsh-home-activity/delegations`、`@deepseek-ai/dsh-subagent` 和受支持的提供方。命令支持 `spawn`；启用可选的原生 Codex 或 Claude Code 提供方后，也支持 `codex` 或 `claude-code`。

### 命令参考

| 命令 | 行为 |
|---|---|
| `/activity create <JSON>` | 保存名称、目标，以及包含 `inScope` 和 `outOfScope` 字符串数组的 `boundaries` 对象。至少需要一项 `inScope` 内容。 |
| `/activity list` | 按创建时间从新到旧列出已保存 Activity 的名称和稳定 id。 |
| `/activity open <activity-id>` | 显示已保存的目标、描述性范围（范围内语句从 1 开始编号，供继续命令选择）、当前用户备注和最近修订、最新战略简报、上下文引用、委派记录、已捕获的 profile 和 preset 选择，以及依据已保存生命周期事实和当前已注册提供方路由提供的只读后续操作。较早的简报修订仍会保存，可用 `/activity brief <activity-id> <revision>` 查看。路由注册不代表凭据就绪、用户同意、原生权限或提供方已准入。 |
| `/activity brief <activity-id> <revision>` | 查看指定的已保存战略简报修订及其证据和不确定性引用。视图会显示后续保存的观察，不会重新读取仓库。 |
| `/activity assess <activity-id> <workspace-id> <workspace-id>` | 明确请求对恰好两个已注册 Workspace 进行建议性战略评估。如果当前 profile 未挂载只读协调器，或 Agent 的工具限制排除了它，DSH 会在加载 Skills 或启用请求守卫前报告该问题。否则，DSH 会把两个 Sensemaking Skills 加载到活动 Agent 的记录任务中。读取前，现有协调器会针对确切任务和所选 Workspace 另行请求一次性批准；获得批准后，它会为每个 Workspace 启动一个只读 DSH 子级 Session，且不提供实现或仓库修改工具。仅适用于该请求的工具会保存结构化简报，并将仓库 id、修订和观察时间绑定到来源 Session 中匹配的成功协调器工具结果元数据；内容、引用和发现仍由 Agent 撰写。 |
| `/activity assess cancel` | 丢弃当前 Session 尚未完成的简报请求，阻止该请求保存结果，但不会停止已获准并正在运行的仓库读取。其他模型工具调用会继续被阻止，直到当前轮次结束且已获准的协调器调用返回。 |
| `/activity annotate <activity-id> <JSON>` | 追加一条用户撰写的协调备注或更正，不修改提供方报告或专家断言。JSON 必须包含 `text`；`/activity open` 会单独显示当前备注和保留的修订历史。 |
| `/activity workspaces` | 列出注册 Workspace 的名称、id 和目录。可以使用两个 id 请求评估，也可以将 Workspace 关联到 Activity。 |
| `/activity sessions` | 列出已存储的 DSH Session 及可用摘要元数据。 |
| `/activity link <activity-id> workspace <workspace-id>` | 添加 Workspace 引用，不修改 Workspace 记录。 |
| `/activity link <activity-id> session <session-id>` | 添加 DSH Session 引用，不修改 Session 日志。 |
| `/activity unlink <activity-id> workspace <workspace-id>` | 删除 Workspace 引用，保留源记录。 |
| `/activity unlink <activity-id> session <session-id>` | 删除 DSH Session 引用，保留 Session 日志。 |
| `/activity artifact add <activity-id> <delegation-id> <workspace-id> <JSON>` | 为该 Activity 的委派记录输出指针，并要求所选 Workspace 已关联到同一 Activity。JSON 字段为 `label`、`location` 和可选的 `revision`；缺少修订版时显示为未知。 |
| `/activity handoff add <activity-id> <JSON>` | 为现有 Activity 记录用户提供的外部交接。JSON 字段为 `source`、可选的 `summary`、可选的 `sourceReference`，以及可选的 `artifacts`（含 `label`、`location` 和可选的 `revision`）。至少需要摘要、来源引用或一个产物引用。 |
| `/activity delegate <activity-id> spawn <task>` | 保存请求，显式启动一次 DSH 原生子级执行，并分别报告提供方结果。任务最多 4,096 UTF-8 字节。 |
| `/activity delegate <activity-id> codex <task>` | 保存请求，显式启动一次原生 Codex 执行，并分别报告其结果。此操作为一次性执行，不创建 DSH Session。任务最多 4,096 UTF-8 字节。 |
| `/activity delegate <activity-id> claude-code <task>` | 保存请求，显式启动一次原生 Claude Code 执行，并分别报告其结果。此操作为一次性执行，不创建 DSH Session。任务最多 4,096 UTF-8 字节。 |
| `/activity continue <activity-id> spawn|codex|claude-code in-scope:<n> <bounded next step>` | 显式启动一次新的委派，包含已保存目标、按 1 起始编号选定的 in-scope 条目，以及用户填写的下一步；不会恢复先前提供方执行。Activity 范围仅为描述；原生提供方权限保持不变。 |
| `/activity review set <activity-id> <delegation-id> <JSON>` | 为已保存的提供方报告记录明确的用户处置和可选的用户提供证据，且不修改该报告；报告保存前命令会拒绝审核。JSON 必须包含 `disposition`（`pending`、`accepted`、`declined` 或 `requires-investigation`）；可选 `evidence` 包含 `source`、`result`（`passed`、`failed`、`inconclusive` 或 `unavailable`）和 `summary`，以及可选的 `reference` 和 `observedAt`。响应会区分新证据、保留的证据和未记录证据。 |

备注 JSON 最多为 16,384 个 UTF-8 字节，备注文本最多 4,000 个字符。备注必须为单行，且不接受控制、格式、行分隔或段落分隔字符。每个 Activity 最多保留 256 条用户命令修订；`/activity open` 显示当前备注和最近 8 条，较早修订仍会保存。写入被拒绝并不能确认修订是否已持久化或回滚。JSON 存储可能在替换文件后才报告错误，因此请重启 DSH，再打开 Activity 检查已保存历史，然后决定是否重试。

创建、产物和审核 JSON 均限制为 16,384 个 UTF-8 字节。每个 Activity 最多关联 256 个 Workspace、256 个 DSH Session 和 512 个产物指针。审核证据会在当前审核记录中追加保存，每个委派最多 128 条。证据记录用户填写的来源和报告结果；DSH 不会检查这些信息。提供方成功仍只是提供方报告，不代表已经验证或被用户接受。必须先保存提供方报告才能审核。委派请求会在提供方启动前保存；拟用 `spawn` 子级 Session id 不代表已准入，外部提供方也不会虚构 DSH Session 身份。DSH 接受 activation 后命令即返回，后续结果记录独立继续。启动在调用提供方前被拒绝时会记录为未准入。如果 Codex 或 Claude Code 的启动调用在已开始调用提供方后拒绝，结果会保持未确认，因为外部运行可能已经启动；除非独立确认其未启动，否则不要重复任务。打开 Activity 不会重试。如果 `spawn` 准入状态不确定，`/activity sessions` 会显示拟用 id 是否对应已存储 Session 及其可用摘要元数据，但不会检查转录。找不到 Session 不代表启动失败。外部准入记录提供方适配器的 `SubagentRun.id`，不代表 DSH Session 或原生提供方对话 id。产物指针与报告分开保存，并明确指出它们与输出之间的关系未经验证。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

此命令仅供用户明确调用，不是模型工具。创建、列出和打开使用 `ctx.homeActivities`；上下文引用使用 `ctx.homeActivityAssociations`；委派沿用 `ctx.subagents.startActivation` 生命周期，并另行保存持久记录；审核使用 `ctx.homeActivityReviews`。DSH `spawn` 会在启动前捕获启动器的 profile bundle 选择和当前 Agent preset 的确切模块。Codex 和 Claude Code 因其外部运行时不会提供 DSH profile 或 preset 信息而显示为不可用。此命令不会创建 Goal，也不会声称提供方报告已经过验证或接受。 外部交接使用 ctx.homeActivityHandoffs。



| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 命令注册、输入校验与用户可见结果 |
| [`src/responsibility-status.ts`](src/responsibility-status.ts) | 仅供目标 Session 使用并绑定实时 Session 与日志调用事件的状态工具 |
| [`src/delegation-command.ts`](src/delegation-command.ts) | 委派解析、生命周期与用户可见结果 |
| [`src/next-actions.ts`](src/next-actions.ts) | 根据已保存结果和已注册提供方路由生成只读恢复提示 |
| [`src/continuation-command.ts`](src/continuation-command.ts) | 解析明确的继续请求并复用现有提供方路径 |
| [`src/execution-selection.ts`](src/execution-selection.ts) | 捕获 DSH profile 和 preset，并进行保守的产品分类 |
| [`src/association-command.ts`](src/association-command.ts) | Workspace 和 Session 目录、引用命令与解析 |
| [`src/artifact-command.ts`](src/artifact-command.ts) | 用户关联的产物指针命令与显示 |
| [`src/review-command.ts`](src/review-command.ts) | 审核输入、持久化命令与结果显示 |
| [`src/handoff-command.ts`](src/handoff-command.ts) | 用户提供的外部交接命令与显示 |
| [`tests/command.spec.ts`](tests/command.spec.ts) | 命令行为、安全失败与不执行断言 |
| [`apps/web/tests/home-activity-review.e2e.ts`](../../../apps/web/tests/home-activity-review.e2e.ts) | 通过组装后的 Web 应用和命令 RPC 验证处置与证据 |
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

模型输入会间接通过显式的 `/activity assess`、`/activity delegate` 和 `/activity continue` 命令，以及符合条件目标 Session 的状态工具产生。

#### KV 缓存影响

显式评估会把 Activity 目标、所选 Workspace 根目录和已加载的 Sensemaking Skill 正文加入当前 Session。现有协调器只有在针对确切任务和所选仓库另行获得一次性批准后，才会为每个仓库启动一个只读 DSH 子级 Session；这些 Session 可以检查仓库来源，但不能实现或修改任一仓库。评估本身不会启动实现、授予写入权限或更改活动 Agent 现有的工具和权限。实现委派仍是单独的 Activity 操作，并使用其自身的提供方授权。只有存在已准入或结果未确定的 Activity 责任分配时，实时根 DSH Session 才会看到目标状态工具。该工具会追加进展、等待、可供审查、受阻或失败等自我报告状态；它不能分派工作，也不能更改完成、验证或接受状态。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

Activity 范围说明描述请求的工作；它们不会更改提供方权限。`spawn` 由 DSH 运行时策略控制；`codex` 由 Codex 原生配置和指定权限模式控制；`claude-code` 遵循 Claude Code 原生配置和权限处理。

- Web composer 与 SDK session.run() 是受支持的交互界面；没有独立 Activity 浏览器或原生 Desktop 命令。SDK profile 必须加载 Home Activity 插件。
- 创建输入为 JSON 文本，且此命令不支持编辑或删除 Activity。`/activity continue` 会记录一项新的明确请求；选择描述性范围语句无法在语义上证明下一步符合该语句，也不会限制提供方权限。Codex 和 Claude Code 执行仍为一次性操作，Activity 无法恢复、检查或回滚它们。Session 目录只显示摘要元数据，不检查子级对话或证明提供方已准入。
- 评估要求两个已注册 Workspace 和接收 Agent 的 DSH Skill registry 中可用的两个 Sensemaking Skills。记录器会将仓库 id、`HEAD` 修订、工作树状态和观察时间绑定到来源 Session 中匹配的成功协调器工具结果，但不会独立检查来源内容、引用或发现。来源不可用、存在未提交变更、观察期间变化或稳定性未知时，简报必须标为不完整。已保存简报由 Agent 撰写，不是独立验证或用户接受；重新打开 Activity 不会重新检查仓库修订，因此当前适用性可能不确定。评估会安装请求级工具守卫，直到简报保存或取消且当前轮次结束前阻止无关的模型工具调用。守卫不会更改已配置的权限；经批准的仓库分析会为每个选定 Workspace 启动一个只读 DSH 子级 Session。
- 审核证据及其报告结果由用户提供，DSH 不会检查。用户更改处置前，当前状态保持待处理；报告执行成功不会自动接受结果。
- `/activity open` 会把已知的提供方停止原因显示为提供方报告的完成、失败、部分输出或拒绝；无法识别的原因仍显示为未知。可用时会显示报告来源和时间，以及不确定状态的来源类别和观察时间。DSH 不会检查已保存报告的新鲜度，因此报告可能已过时；打开 Activity 不会查询提供方后续状态，也不会重试工作。
- 对于待处理或状态不确定的启动，恢复提示只提供检查操作。只有已保存结果支持新工作且提供方路由已注册时，才会提示用户单独、明确地发起新请求；路由注册不代表凭据可用、用户同意、原生权限或已获准入。Activity 不提供停止操作，外部一次性运行没有 Activity 状态查询、转录检查或恢复操作。未知结果会继续保持未解决状态。
- 产品分类仅使用捕获的 bundle 列表或活动 preset 模块，以及产品提供的元数据。profile patch 和运行时 overlay 不参与分类；稳定标签仅适用于与已发布 profile 模板的 bundle 列表完全相同的情况，未分类的 preset 会显示为不可用。这些标签不代表沙箱隔离、权限强制执行或 Skill 资格。
- 产物位置、修订版和 Workspace 选择由用户提供。命令不会检查被引用的文件，也不会从 Workspace 目录推断 Git 根目录；缺少的修订版保持未知，指针不验证执行上下文或提供方输出。

- 外部交接的来源标签、摘要和产物引用均由用户提供；命令不会导入外部 transcript、同步外部 Session，也不会验证所报告工作的执行者。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
