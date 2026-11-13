# Agent Note: Modular coding environment roadmap

Status: proposed

[English](2026-11-10-modular-coding-environment-roadmap.md) | 中文

## Problem

所有者已选择 DeepSeek Harness（DSH）作为模块化编程 agent 环境的共同执行基础。仓库已经提供模型适配器、agent 委派、Skill、工作区、持久 Session 等可组合能力。其他仓库描述了更多技能、工作流、运行时扩展、请求接入、语义知识和任务协调能力，但仓库名称本身不能证明 DSH 缺少这些能力，也不能证明上游实现可以原样复用。

若没有一份长期维护的说明，记录当前能力、所有者选定的方向、候选来源和待决问题，后续工作可能把已完成的连接试点误认为多仓库产品，重建 DSH 已有机制，或在没有所有者决定的情况下让 DSH 与独立系统耦合。

## Proposal

保持 DSH 为共同执行基础，并有选择地适配能够带来明确用户或维护者价值的能力。将本路线图视为暂定的构建顺序和决策背景，不把它当成实现所有条目的授权，也不要求机械地按列表顺序实现。

选择下一项责任时，应先明确一个范围有限的结果，确认相关 DSH 机制与来源证据，指出权限和集成依赖，并在实现前设定可观察的验收标准。当真实依赖、用户需求或已验证的复用机会改变构建选择时，应重新评估顺序。

### 产品方向与能力状态

所有者选定的方向是模块化编程环境：可将多个模型和 agent 运行时与多个仓库中的工作组合成连贯的开发流程。用户应能组合可复用的 Skill、专用 agent、命令和可配置 hook；跨 Session 恢复有界工作；并使用自适应委派、上下文管理、记忆、学习、可观察性、验证、权限和证据来源记录。高级 Sensemaking 与持久任务协调仍属于可选能力。

所有者确认的 Windows 多模型试点已经完成。该试点建立了多模型委派基础；它没有证明一次对话可以编排多个仓库、原生 Session 共享、provider 认证或权限策略共享，也没有确立与任务控制系统的关系。

| 状态 | 现有能力 | 证据的限制 |
| --- | --- | --- |
| 已由完成的试点验证 | DSH 可通过多个模型/运行时集成委派工作；参见[原生 Codex](../../../../packages/subagent/subagent-codex/README.zh.md)和[Claude Code](../../../../packages/subagent/subagent-claude-code/README.zh.md) provider。 | 各 provider 保留自己的 host Session、认证、设置和执行控制。试点完成不等于实现了跨仓库编排或共享权限。 |
| 已演示的 Priority 2 切片 | Web profile 提供 `/review`，组合了可复用 reviewer Skill、受限子 preset 和建议性质的证据 hook；参见 [`dsh-command-code-review`](../../../../packages/interaction/command-code-review/README.zh.md)。 | 这是一个只读工作流，通过生产 Loader 和 AgentLoop 配合确定性模型 adapter 验证；它并未完成整组可复用能力，也未验证实时模型或原生 provider 行为。 |
| 可复用指令与 agent | [文件系统 Skill provider](../../../../packages/skill/skill-filesystem/README.zh.md)、[subagent providers](../../../../packages/subagent/README.zh.md)和[agent preset](../../../../packages/preset/README.zh.md)可加载可复用指令并组合子 agent。 | 不能假定不同 host 的发现方式和 Skill 行为相同；应逐一验证目标 host。 |
| 用户命令与扩展点 | DSH 提供[交互命令](../../../../packages/interaction/README.zh.md)、Cordis 插件组合与事件，以及若干实验性兼容集成。 | 这些机制尚未组成统一的 hook API；hook 仅因被执行并不会自动获得安全策略权限。 |
| 项目与任务协调 | [工作区](../../../../packages/workspace/workspace/README.zh.md)按名称归组项目和 Session；[Team](../../../../packages/team/agent-team/README.zh.md)、[Workflow](../../../../packages/workflow/workflow/README.zh.md)、[Goal](../../../../packages/goal/goal/README.zh.md)、[Job](../../../../packages/jobs/README.zh.md)和[Schedule](../../../../packages/schedule/README.zh.md)提供不同的协调机制。 | 项目归组不等于一个多仓库对话。这些机制也不会自动形成统一的持久委派产品或 Dark Factory Campaign。 |
| Session 历史与上下文 | [Session 日志](../../../../packages/session/README.zh.md)、[Session 查询](../../../../packages/session-query/README.zh.md)、[上下文](../../../../packages/context/README.zh.md)、[压缩](../../../../packages/compaction/README.zh.md)、反馈和遥测包支持历史重建与观测。 | 这些能力本身不等于跨仓库语义记忆或经验证的学习策略。 |
| 执行控制 | DSH 在 provider 各自的原生控制之外还提供凭证、审批和[sandbox](../../../../packages/sandbox/README.zh.md)能力。 | 尚未证明父级策略能约束每个原生子进程；每种集成都必须明确权限与证据规则。 |

### 路线图证据检查点

路线图衡量已验证的开发者结果，而不只看软件包是否存在或局部测试是否通过。本检查点区分已合并的能力、未合并的候选变更、仅在本地实现的工作，以及尚未验证的完整用户流程；它不改变暂定优先级。

| 优先级 | 已有证据 | 尚未确立的用户结果 |
| --- | --- | --- |
| 1 — 多仓库 | [PR #8](https://github.com/ThorStarlord/deepseek-harness/pull/8) 已合并只读跨仓库分析工作流。 | 尚未演示在一次授权对话中对选定仓库协调修改并完成评审。 |
| 2 — 可复用工作流 | [PR #9–#12](https://github.com/ThorStarlord/deepseek-harness/pulls?q=is%3Apr+is%3Amerged) 已合并有界代码审查、基于证据的汇报、测试驱动指导和组合式 Web 开发工作流。 | 单项能力尚未验证跨原生 agent host 的可移植性，也未构成完整的多 agent 开发体验。 |
| 3 — 委派工作 | [PR #13](https://github.com/ThorStarlord/deepseek-harness/pull/13) 包含子 turn 结果与冷读来源修正，但仍待产品/设计评审。另有一个只读核对命令据报告已在未发布的本地分支上实现。 | 两条工作线都尚未集成为完整的“委派—检查—核对—授权继续”体验；已报告的重启与真实模型证据只覆盖有界情形。 |
| 4 — 自适应与学习 | DSH 已提供路由、Session 历史、上下文和反馈机制。 | 尚未验证来源可追溯的自适应决策，以及纠正记忆后对未来授权工作的影响能形成完整产品体验。 |
| 5 — 可选高级集成 | Sensemaking 与任务控制仍是可选候选能力，并非已确立的 DSH 运行时所有者。 | 两项集成都尚无已接受的责任归属决定和经验证的端到端收益。 |

未合并 PR 的测试通过不代表其行为已经进入规范主分支。未发布的本地命令不属于已评审的产品能力。临时提交详情、环境诊断和录制尝试应保留在相应验证记录中，而不是作为路线图状态长期维护。

### 候选来源仓库

以下候选来源可供有选择地评估。下列引用仅支持所述能力，不代表 DSH 已集成，也不证明上游行为可移植。仓库许可证仅适用于该仓库材料，不会自动涵盖独立的托管服务或依赖项。

| 来源与证据 | 值得评估的能力 | DSH 现状与可能的复用方式 | 限制、依赖和待验证事项 |
| --- | --- | --- | --- |
| [Everything Claude Code（ECC）](https://github.com/affaan-m/ECC) 的 [README](https://github.com/affaan-m/ECC/blob/main/README.md) 与 [MIT 许可证](https://github.com/affaan-m/ECC/blob/main/LICENSE) | 可复用 Skill、专用 agent、命令、hook、规则、记忆实践和多 host 配置。 | DSH 已有 Skill、agent、命令、插件扩展点和实验性 hook 兼容。可选用单个 Skill/工作流内容，或通过 DSH 所属扩展点适配特定 hook/配置。 | 适配前须检查各 host 的命令、工具和 hook 语义。不得假定仓库许可证也适用于独立的 ECC Tools 服务，或其 host 配置无需修改即可在 DSH 运行。 |
| [Superpowers](https://github.com/obra/superpowers) 的 [README](https://github.com/obra/superpowers/blob/main/README.md) 与 [MIT 许可证](https://github.com/obra/superpowers/blob/main/LICENSE) | 用于构思、实现计划、测试驱动开发、调试、验证和 subagent 驱动工作的 Skill；以及按 host 区分的安装说明。 | DSH 的 Skill provider、subagent 和 workflow 机制提供了可选承载位置。可复用少量兼容 Skill，或将有价值的工作流重新表达为 DSH 配置或插件。 | 上游安装方式和工具名称因 host 而异。将其视为可移植内容之前，应检查 Skill frontmatter、工具假设，并在 DSH 中验证每项工作流；不要整体引入上游套件。 |
| [DSH Superagent Prototype](https://github.com/ThorStarlord/dsh-superagent-prototype) 的 [README](https://github.com/ThorStarlord/dsh-superagent-prototype/blob/main/README.md) 与 [MIT 许可证](https://github.com/ThorStarlord/dsh-superagent-prototype/blob/main/LICENSE) | 研究原型包含 GitHub 或可选 Feishu 请求接入、准入、Ticket 与 Assignment、worker Session、隔离的 Ticket 目录和操作员交接等模式。 | DSH 已有 workspace、subagent、Session、Goal、Job 和 Team 基础机制。应对照这些机制评估经过验证的接入或交接模式；若实现，应在适用处使用 DSH 现有的组合与持久化机制。 | 上游 README 将项目标为研究原型，而非官方或可用于生产的产品。请求接入凭证、Feishu、Ticket 策略和目录隔离会引入依赖；原型行为不构成生产权限模型。 |
| [Dark Factory](https://github.com/ThorStarlord/dark-factory)，当前比较见[本 fork 基础文档](../../../../docs/fork-foundation.zh.md) | 持久任务权限、Campaign 转移、有界委派、证据接纳与协调、受保护集成和恢复。 | DSH 有相邻的 Goal、Workflow、Team、Session 和 sandbox 能力，但语义并不等同。保持 Dark Factory 独立。未来若要建立关系，必须在独立 Harness、类型化分层适配器或逐项能力整合中明确选择。 | 仓库为私有，检查过的源码元数据没有声明公开许可证。未经所有者授权不得复用源码。不得假定共用数据库、Goal 等同、权限继承或迁移授权。 |
| [Sensemaking Skills](https://github.com/ThorStarlord/sensemaking-skills) 的 [README](https://github.com/ThorStarlord/sensemaking-skills/blob/main/README.md) 与 [MIT 许可证](https://github.com/ThorStarlord/sensemaking-skills/blob/main/LICENSE) | 通过可复用 Skill 进行本地仓库理解、带来源的知识、前瞻推理和可选构建指导。 | DSH 可加载 Skill，并提供 Session 查询、上下文、反馈和遥测。这些集成有用，但不等同于持久语义仓库模型。先将 Skill 或参考资料作为可选能力；只有验证出持久能力需求后，才考虑 DSH 插件。 | 源码将其描述为本地优先的 Python 工具和 Skill。跨项目迁移、长期知识质量、写入权限、保留策略和维护成本都需要直接评估；默认不将其作为核心依赖。 |
| [Pi](https://github.com/earendil-works/pi) 的 [README](https://github.com/earendil-works/pi/blob/main/README.md) 与 [MIT 许可证](https://github.com/earendil-works/pi/blob/main/LICENSE) | 精简 agent 运行时、多 provider 模型 API、Skill、package 和扩展/插件机制。 | DSH 已在 [Pi 模型适配器](../../../../packages/llm/llm-pi-ai/README.zh.md)中使用 pi-ai。[Pi 扩展](2026-10-03-pi-extensions-bridge.zh.md)和 [Pi 插件](2026-10-03-pi-plugins-compatibility.zh.md)提案记录了兼容性差距，但都不是已发布的 bridge。只有在用户有实际需求时，才评估特定适配器或兼容级别。 | Pi 的 README 声明 Harness 没有内置权限系统，且部分 agent 能力不属于其核心。DSH 必须保留自身执行与权限控制。Pi 扩展和插件 API 的成熟度及 host 行为不同；使用前应重新检查具体版本并逐项测试支持能力。 |
| [OpenCode](https://github.com/anomalyco/opencode)，DSH 的[请求恢复决策记录](../../implemented/architecture/2026-06-21-bounded-llm-request-recovery.zh.md)仅记录了有限比较 | 仅作有界请求恢复的比较来源。 | DSH 已自行管理 provider 失败、可见的重试尝试和持久重试状态。此前比较可辅助未来的特定评审；它没有发现 DSH 子系统缺口，也没有选定集成方案。 | 本文未记录对 OpenCode 的全面能力或许可证评估。若用于新决策，应先核验固定版本的上游源码及其许可证。 |

### 暂定构建优先级

所有者选定了以下初始顺序。每组都描述用户结果与完成证据；顺序可以调整，完成某项也不会自动授权下一项。

#### 1. 在一次对话中编排多个仓库

**目的与用户能力：**用户可通过一个连贯的编程流程处理明确选定的多个仓库，并能辨认每个操作、改动和结果所属的仓库。

**现有基础：**DSH 有持久 workspace 项目、文件系统与进程 provider、持久 Session 和 subagent。workspace 归组本身并不会让多个仓库都能被一个对话访问。

**依赖与有意义的完成标准：**明确仓库成员关系、工作目录或 worktree、分支所有权、各仓库权限和结果归属。通过一个用户任务证明：读取并修改至少两个选定仓库，记录每项改动的来源，并遵守各仓库独立控制。不得假定原生 Session 或凭证上下文共用。

#### 2. 可复用 Skill、专用 agent、命令和可配置 hook

**目的与用户能力：**用户可复用维护中的流程和特定角色 agent，可调用命名命令，并能为所选工作流配置事件驱动扩展。

**现有基础：**DSH 有 `SKILL.md` 加载、subagent provider 与 preset、交互命令、Cordis 插件和事件，以及有限的实验性 hook 兼容。ECC 与 Superpowers 可提供候选内容和模式。

**依赖与有意义的完成标准：**为采用的每种机制定义配置、组合、顺序、生命周期、host 兼容和错误报告。一个有用的发布应使用户能在受支持的 Profile 中启用一个文档化 Skill、agent、命令和 hook，验证每项行为，并说明 host 语义差异。执行权限必须归于明确的策略所有者；回调本身不是权限系统。

#### 3. 持久委派工作与有界自主续行

**目的与用户能力：**用户可委派范围明确的任务，离开或重启父对话，之后再检查、继续、取消该子任务，或在规定限制内接收结果。

**现有基础：**DSH 已有持久 Session、可继续的 subagent、每个 Session 的 Goal、Team 任务看板、Workflow、后台 Job 和定时跟进。这些机制的所有者和生命周期不同；此方向可以是组合或针对性产品工作，而不一定需要新基础设施。

**依赖与有意义的完成标准：**明确任务所有权、持久状态、恢复与取消行为、自主权限限制、返回父任务的证据，以及进程丢失后的恢复方式。针对相关重启和失败情况验证委派任务。不得将这些机制等同于 Dark Factory Campaign 权限。

#### 4. 自适应编排、记忆、上下文管理和学习

**目的与用户能力：**环境可依据观测到的工作选择合适的委派与上下文操作，同时保留可检查证据，并允许用户纠正或限制结果。

**现有基础：**DSH 已有 provider 路由、上下文组装、压缩、Session 搜索与追踪、反馈和遥测。这并不表示它已有持久的跨仓库语义记忆或经过验证的学习策略。

**依赖与有意义的完成标准：**首先定义哪些数据可以保留、谁可以读取或修改、如何归属与纠正证据，以及哪些操作需要审批。完成一项有界工作流，使用户可检查一次自适应选择的来源证据、纠正错误记忆，并确认修正只影响获授权的后续工作。

#### 5. 高级 Sensemaking 与可选任务控制集成

**目的与用户能力：**当具体工作流确有收益时，用户可添加带来源的仓库推理或持久任务协调，但这两者都不是普通 DSH 编程任务的前置条件。

**现有基础：**可将 Sensemaking Skills 作为可选指导来评估。DSH 已有 Session 和任务协调机制。Dark Factory 仍是具有不同权限模型与 Campaign 记录的独立系统。

**依赖与有意义的完成标准：**分别确认每种可选能力的用户价值及数据/权限模型。采用 Sensemaking 时须验证输出质量、来源和生命周期行为。若要与 Dark Factory 建立关系，须先由所有者作出新的明确决定，选定 A/B/C 关系，并在实现前定义类型化权限与证据交换。继续保持独立也是有效结果。

### 架构界限与待决选择

选择工作时应保留以下区别：

- 多模型 provider 不代表已经实现多仓库编排。
- 原生 Codex 与 Claude Code 默认不共享 Session、认证上下文或权限策略；DSH 适配器不会消除 host 各自的控制。
- 可移植的 `SKILL.md` 可能依赖 host 特定工具或约定。应验证每个目标 host，不承诺行为一致。
- DSH 的 Task、Goal、Workflow、Team 和 Session 有各自的契约；它们都不等同于 Dark Factory Campaign。
- Hook 只能在已配置的运行时中观察或转换事件。安全执行需要明确的权限主体和策略路径。
- 当审查或验收需要这些事实时，证据应记录来源、仓库、Session 或运行、agent/provider 以及相关权限上下文。
- 在未来明确决定选择其他关系之前，Dark Factory 保持独立。现有 A/B/C 选项仍未选定。

多仓库对话的仓库选择、worktree 所有权和分支集成顺序仍待决定。Hook 配置的用户界面和各 host 的 Skill 发现方式仍待决定。语义记忆的保留、纠正和权限模型仍待决定。重启后继续工作的运行时与恢复模型仍待决定。不得因为选择某个来源仓库，或复用名称相似的 DSH 机制，就暗中解决这些选择。

### 如何选择下一项范围明确的责任

仅在仓库证据支持时，才从本路线图选择一项用户或维护者结果。先检查当前 package 所有者及其文档行为。若涉及外部材料，检查候选来源与许可证。区分已有机制和实际缺口，并在选择设计前写明集成、权限和来源追踪要求。定义小而可观察的验收结果以及相关的仓库规定检查。若权限、依赖或用户价值仍不明确，应记录决策界限，而不是实现未经确认的假设。

### Priority 3 的经验与战略再评估

恢复调查区分持久 Session 事件、冷读时合成的结束事件、仓库当前观察结果和推断。即使目标文件现在存在，缺少持久结果的 `tool/call` 仍有不确定性：当前满足预期条件不能证明是哪次操作造成的。冷读检查不得重放副作用、把重建证据提升为持久执行结果，或授予继续执行的权限。

这些调查也表明，现有 Session 持久化、修复、查询和 subagent 机制已经覆盖大量必要行为；只有发现明确缺失的责任时才增加基础设施。确定性测试、操作系统进程重启探测、真实模型支持的 Web 运行、经过评审的 PR，以及已集成的用户工作流所支持的结论各不相同。难以录制的场景、未合并分支或无人回应的产品/设计评审属于验证或发布依赖，不是新运行时缺陷的证明。

一连串各自有依据的局部修正，仍可能消耗工程投入，却没有交付完整产品体验。选择更多 Priority 3 构建任务前，应以连贯的开发者工作流重新比较五项优先级：从意图和授权委派，到来源明确、可检查的工程结果。区分已有机制、已合并能力、未发布工作、缺失集成、未经验证的行为，以及评审或环境约束。下一项有界责任应按其对端到端用户价值的贡献选择，而不是只因它接续上一项子任务；这是一次战略检查点，不是每次修改都必须经过的分析关卡。

一个可比较的候选流程是：开发者向明确选定的多个仓库中的专用 agent 分配有界任务，并收到带有来源和权限归属、可供评审的改动。这只是待评估的候选方案，不代表已决定调整优先级或授权 DSH 与 Dark Factory 耦合。

## Alternatives considered

**将一个框架整体作为产品架构。** 不采用，因为候选仓库的运行时、权限、持久化、成熟度和许可证各不相同。DSH 已有可复用的执行基础；整体采用会把无关的产品决策耦合起来。

**在 DSH 内重建 Dark Factory。** 不采用，因为名称相似不能证明任务权限、Campaign 状态转移、证据接纳或恢复语义等同。该关系仍是未来需明确决定的事项；在此之前 Dark Factory 保持现有权属。

**将已完成的多模型试点视为下一项产品。** 不采用，因为它证明了 provider 连接和委派，但没有证明所有者选定的多仓库工作流或共享权限。

**将路线图放入常驻指令或架构参考文档。** 不采用，因为路线图是拟议的策略方向，不是常驻命令或当前架构契约。本拟议 Agent Note 记录其理由；现有 fork 基础文档负责链接发现。

## Acceptance criteria

- 新的 coding agent 能从 fork 基础文档找到已选定的 DSH 基础和暂定优先顺序。
- 本 Note 区分已完成的多模型试点、现有 DSH 能力和拟议工作。
- 每个要求的候选来源都提供证据链接、明确范围的能力描述、与 DSH 的比较、可能的适配形式，以及重要限制或许可证状态。
- 本 Note 写明所要求的架构界限，保持 Dark Factory 独立，并在不暗中决定的情况下记录待决选择。
- 中英文版本结构对应，且重新生成配对记录。
- 文档检查通过；若唯一失败是已独立确认的 Windows 符号链接限制，应以准确证据报告，且不得隐瞒其他失败。

## Risks

- 上游功能、名称和许可证可能变化；实现工作必须重新检查确切来源与版本，不能将此清单视为永久背书。
- 能力清单可能变成第二份过时目录。DSH 当前行为仍以 package README 和源码为准；本 Note 只负责策略比较和未决的构建选择。
- 优先级可能被误认为承诺或依赖。具体任务带来新证据时应重新评估顺序，不得仅因完成前一组就实现后一组。
- 相似的工作流术语可能隐藏不同的权限或持久化语义。应明确记录每种集成，并保留独立的运行时、认证、权限和证据控制。
