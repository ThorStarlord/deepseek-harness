# Agent Note: 模块化编程环境开发路线图

Status: proposed

[English](2026-11-10-modular-coding-environment-roadmap.md) | 中文

## 问题

DeepSeek Harness 已有 Cordis 插件基础、DSH subagent、原生 Codex 与 Claude Code 委派适配器、文件系统 Skill provider、持久 Session，以及任务和 workflow 机制。`docs/fork-foundation.md` 说明了它们的不同职责，但写于所有者完成 Windows 多模型试点之前，尚未建立更广泛的模块化产品开发方向。

如果缺少一份持久的提案，后续 agent 可能重复已经完成的多模型工作，把一次性多模型委派误认为多仓库编排，吸收不相关的软件工厂职责，或在未检查 DSH 现有机制的情况下直接导入外部项目。

## 提案

所有者选择 DeepSeek Harness 作为可扩展编程环境的共同执行基础。后续建设应优先使用可组合的 Cordis 插件、profile、适配器、配置、专用 agent、Skill、命令和 hook，而不是替换运行时。提出新子系统前先复用现有 package。外部仓库提供候选方法或组件，不继承产品决策权。

下列顺序只是暂定的探索与建设偏好，不要求实现所有条目。后续 agent 应依据当前用户价值、依赖关系、源码证据、风险及授权范围选择一项有界职责；如有理由，可以调整顺序或不实施。目标是连贯的多模型、潜在多仓库用户体验，而非集成项目清单。

## 现有基础与证据限制

核心 Cordis profile 组合模型 provider、文件系统与 shell 工具、sandbox 和审批 provider，以及仅追加的 Session 历史（`docs/architecture.md`）。subagent 家族包含受管理的 DSH 子 agent 和独立的 DSH SDK provider；`packages/subagent/subagent-codex/` 与 `packages/subagent/subagent-claude-code/` 提供原生外部一次性委派。`packages/skill/skill-filesystem/` 发现并加载本地 Skill。现有 Goal、Workflow、Team、Jobs、Schedule、context 与 compaction package 分别承担较窄的延续职责。

所有者报告 Windows 三 agent 多模型试点已经完成；PR #5 已合入所检查 fork 的基线。这是已完成的技术基础，而非未完成的路线图项。现有原生 provider 文档仍限制试点可支持的结论：子会话、凭据、权限、transcript 可见性与回滚仍由不同宿主管理。本次文档工作未独立复现试点，也未验证多仓库对话。

## 候选来源仓库

**[Everything Claude Code (ECC)](https://github.com/affaan-m/ECC) — Skill、专用 agent、命令、规则、hook 及上下文/学习实践。** 候选复用方式是选择性适配 Skill 和命令、配置及经过明确映射的 hook 事件。DSH 已有 Skill 加载、subagent 与扩展事件；与 ECC 支持的宿主是否等效尚未验证。检查到的上游仓库包含 MIT 许可证。应使用当前 `affaan-m/ECC` 地址，而非非官方镜像。

**[Superpowers](https://github.com/obra/superpowers) — 可组合的软件开发 Skill 与从设计到实施的方法。** 候选复用方式是单独的方法和 agent 指导，而非替换编排器。DSH 已能运行 agent 和任务；行为契合度及调用差异尚未测试。上游仓库包含 MIT 许可证。

**[DSH Superagent Prototype](https://github.com/ThorStarlord/dsh-superagent-prototype) — GitHub/可选 Feishu 接入、准入后的 ticket、worker Session、隔离工作目录和操作员交接。** 候选复用方式是通过 DSH 原生插件适配有界接入、工作单元与恢复模式。该项目明确属于研究代码，聚焦单个 GitHub 仓库，并非生产级验证。检查到的仓库包含 MIT 许可证。

**[Dark Factory](https://github.com/ThorStarlord/dark-factory) — 受授权的 Goal 修订、Campaign 状态转换、证据、受保护集成和恢复。** 候选复用方式是任务治理概念或未来明确的证据适配器，而非共享数据库、自动吸收，也不能将其概念等同于 DSH Goal、Workflow、Task 和 Session。Dark Factory 保持独立。本次检查未确认根目录 `LICENSE`，不得据此授权复制代码。

**[Sensemaking Skills](https://github.com/ThorStarlord/sensemaking-skills) — 基于本体的仓库理解、探索性推理、持久且关联源码的知识以及遵守权限的 reconciliation。** 候选复用方式是可移植 Skill 与可选源码/证据适配器，语义决策仍由主动 agent 负责。DSH 已有 Skill 发现能力，但不证明原生宿主间的可移植性或实际行为收益。检查到的上游仓库包含 MIT 许可证。

**[Pi](https://github.com/earendil-works/pi) 生态 — 另一个先前调查过的兼容候选。** 已有提案 Agent Note `2026-10-03-pi-extensions-bridge.md` 与 `2026-10-03-pi-plugins-compatibility.md` 将其 extension/plugin 概念映射到 DSH 机制。二者仍是提案，不代表已实现等效；任何适配前须复查上游 API 与许可证。

## 暂定建设优先级

每组说明目标用户体验、可复用的 DSH 机制、未解决依赖及可观察的完成标准。可以先调查而不建设；完成一组也不会自动授权下一组。

### 1. 在一次对话中编排多个仓库

**目的与用户体验。** agent 可以在两个或更多明确选定的仓库间完成同一项已授权开发目标，同时不混淆仓库身份、指令、工作树、工具结果或权限。现有 workspace、worktree、subagent、Team 与 Session 机制是候选基础，但不证明这种体验已可用。

**依赖与完成标准。** 调查目标身份、仓库选择、工作区隔离、按目标授权、提交归属、跨仓库依赖证据及故障恢复。真正的完成是从一次对话协调一个有界双仓库任务，保留可复现的按目标变更和证据，不发生意外跨目标修改，并有可理解的恢复路径。

### 2. 可复用的 Skill、agent、命令和 hook

**目的与用户体验。** 操作员无需为每个模型宿主维护分歧副本，就能启用、检查、定制及选择性复用能力。优先复用 DSH 文件系统 Skill、subagent provider、插件 profile、命令注册及生命周期/工具事件；将 ECC 和 Superpowers 作为方法库调查，把 Pi 兼容性提案作为独立选项。

**依赖与完成标准。** 明确版本归属、发现优先级、禁用/不安全能力处理、宿主特定调用、hook 顺序和错误行为。能够观察或拒绝 DSH 工具调用的 hook 不会自动限制独立认证的 Codex 或 Claude worker。完成标准是经实际运行的组合：一个 DSH Skill、一个专用委派、一个命令和一个受控 hook，差异可见且不提升权限。

### 3. 持久委派工作与自主延续

**目的与用户体验。** 获许可的长时间任务在中断后能够恢复，不丢失所有者、当前目标、进度、已接纳证据或升级要求。应先复用 DSH Session、Goal、Team task、Workflow、Jobs 与 Schedule，再考虑新增任务实体；同时检查 Superagent 原型的 ticket 与 worker 生命周期。

**依赖与完成标准。** 解决授权范围、幂等性、租约和归属恢复、取消、副作用记录、人工交接及 worker 结果准入。DSH Task、Goal、Workflow 或 Session 不等同于 Dark Factory Campaign。完成标准是中断的已授权任务能够恢复到有证据支持的结果或明确停止，并且不重复受保护的副作用。

### 4. 自适应编排、记忆、上下文与学习

**目的与用户体验。** 环境检索与决策相关的既有上下文，依据任务和宿主限制委派，从观察结果中学习，并避免重复已经解决的不确定性。现有模型适配器、请求上下文、compaction 与事件溯源 Session projection 提供输入，但不证明自适应策略质量或学习能力。

**依赖与完成标准。** 区分临时上下文、持久任务历史、产品语义知识、模型路由以及行动权限。通过有界延续案例观察：先前验证过的知识是否改变 agent 下一步有价值的行动，同时避免过期事实与无限 token 开销。在具体缺失得到证实前，不新增记忆引擎。

### 5. 高级 Sensemaking 与可选任务协调

**目的与用户体验。** 高级仓库理解与前瞻推理可以指导有界的 DSH 执行；确有用户需求时，可选的任务协调机制保存长期证据和审批。选择性使用 Sensemaking 的可移植 Skill 与关联源码的知识。Dark Factory 保持独立产品，可成为未来的协作对象，但默认不吸收为子系统。

**依赖与完成标准。** 在更深度耦合之前，明确请求/结果/证据适配器、源码修订身份、语义归属、审批与发布权限以及数据可移植性。首个有意义的完成结果是：agent 调用有界 Sensemaking 指导，只执行另行授权的 DSH 工作，并返回可重建的证据。工厂级控制器需要未来独立的产品决策与验证。

## 待定架构决策

多仓库执行可以从顺序工作开始，也可能需要并行隔离 worker；正确选择取决于真实用户任务与按目标故障行为。仓库身份应存于 Session 元数据、workspace registry 还是独立适配器尚未决定。不能假定原生子 agent 的认证、sandbox 与权限范围自动继承父级策略。

可移植 Skill 可以共享单一源码目录，但宿主特定的发现、调用和取消需要实测。DSH 自身的工具/生命周期 hook 不是跨 provider 的安全策略。记忆可以先由 Session 历史和可选外部语义知识组成，直到具体缺口证明统一有必要。未来若与 Dark Factory 协作，需要另行决定归属与证据传递关系。

## 已考虑的替代方案

**导入每个候选仓库。** 不作为默认方案：代码归属、插件生命周期、重复 Skill 和安全语义将难以理解，多次导入还可能重复实现 DSH 已有功能。

**让 Sensemaking 或 Dark Factory 成为强制执行控制器。** 不作为路线图默认方案：Sensemaking 负责语义推理方法，Dark Factory 负责其已接受的生产治理模型；二者都不会自动取代 DSH 的执行基础。

**首先构建全新的通用多 agent 运行时。** 暂缓：Cordis 插件模型与现有委派机制已经提供了坚实起点，目前没有已证实的用户要求足以支持替换它们。

**将五个优先组强制作为固定待办序列。** 不采纳：依赖、证据和用户价值可能改变下一项有界职责的最佳选择。

## 验收标准

文档完成意味着新 agent 能找到已经选定的 DSH 执行基础、现有模型委派能力、五组暂定优先事项、候选上游来源、预期用户结果、有意义的完成观察、依赖、明确非目标和待定决策，而无需猜测未实现的功能已经存在。

在未来实现决策取得独立验证状态之前，本提案保留在 `proposed/architecture/`。本次变更仅限完整的英文/中文/sidecar Agent Note 三件套，以及必要的最少发现链接。合并前必须在准确的候选修订上运行双语配对、Note 格式、链接、换行、字数预算和文档检查；未执行的检查不能算 PASS。

## 风险

路线图可能制造不真实的完成压力，重视功能数量而非连贯用户体验，并掩盖维护多个运行时的成本。将拟议用户结果与现有 package 事实分开有助于降低风险。上游 API 和许可证可能改变；后续每次适配都需基于固定源码审查、安全评估及必要的声明。

独立的原生 worker 可能使用不同的凭据、sandbox 规则与工作目录。扩大委派权限之前，必须分别验证跨仓库写入、hook 强制能力、无人值守恢复以及受保护发布。本次记录的 Windows 试点不能证明这些保证。
