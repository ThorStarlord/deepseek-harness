# 个人 Fork 基础：多 Harness 架构选项

[English](fork-foundation.md) | 中文

## 概述

所有者已选择 DeepSeek Harness 作为模块化编程环境的共同执行基础，支持多个 agent 运行时、多个仓库和可复用能力。[拟议开发路线图](../.agents/notes/proposed/feature/2026-11-10-modular-coding-environment-roadmap.zh.md)记录了发展方向、候选来源、暂定优先级和待决问题。该方向不会选择永久的软件工厂控制器，不会推翻其他仓库已接受的决策，也不承诺统一原生 agent 会话。

所有者确认的 Windows 多模型试点已经完成。该试点建立了本文所述的多模型委派基础；它并未建立多仓库编排、共享原生会话、共享认证或权限策略，也未建立任务控制系统。

## 可复用能力

| 执行路径 | 现有能力 | 初期使用限制 |
| --- | --- | --- |
| DSH 原生 agent | [受管理 DSH subagent](../packages/subagent/subagent/README.zh.md) 可以启动、fork、通信并冷恢复可继续的进程内 agent；独立的 [DSH SDK provider](../packages/subagent/subagent-dsh-sdk/README.zh.md) 会启动另一套 Harness 运行时。 | 两种 DSH 后端的会话和工具可见性不同。 |
| 原生 Codex | [Codex bundle](../packages/subagent/subagent-codex/README.zh.md) 使用固定版本的原生 app-server 进程和单个临时 thread/turn，提供 `subagent_codex`。 | 仅一次性执行；认证和模型设置归原生系统；无子任务 transcript、原生恢复或回滚。 |
| 原生 Claude Code | [Claude Code bundle](../packages/subagent/subagent-claude-code/README.zh.md) 使用固定版本的原生 SDK/CLI 查询，提供 `subagent_claude_code`。 | 仅一次性执行；认证和设置归原生系统；无子任务 transcript、原生恢复或回滚。 |
| 核心环境 | [基于 base 的 Profile](architecture.zh.md) 组合 Cordis 插件、模型适配器、文件系统和 shell provider、sandbox 策略、审批以及持久 Session 日志。 | Profile 层会整体替换目标配置行；插件存在不等于已经验证认证或 sandbox。 |
| 可复用认知能力 | [文件系统 Skill provider](../packages/skill/skill-filesystem/README.zh.md) 扫描项目、自定义和用户目录中的 `SKILL.md`，按需加载正文。 | DSH 能发现 Skill，并不证明原生 Codex 与 Claude Code 的发现或执行方式完全相同。 |

## 相关仓库的职责

| 系统 | 当前职责 | 重要界限 |
| --- | --- | --- |
| 此 DSH fork | agent/模型和工具执行、工作区与安全 provider、Session 持久化、subagent、有界 workflow、goal 和 Team 任务协调。 | Session、workflow 或任务看板不自动等同于持久的软件生产 Campaign。 |
| [Sensemaking Skills](https://github.com/ThorStarlord/sensemaking-skills) | 通过 `using-sensemaking` 提供基于本体的仓库理解、前瞻推理、带来源的知识和可选的可移植构建指导。 | 知识图谱和指导不负责认证 worker，也不授权编辑、合并、发布或部署。 |
| [Dark Factory](https://github.com/ThorStarlord/dark-factory) | 已授权 Goal 修订、Strategic Frontier 评估、Delegation 限额、持久 Campaign 转移、证据接纳与协调、受保护集成及恢复。 | 已接受的 Sensemaking/Archon 权属目前约束 Dark Factory，并不永久否定 fork 中的替代架构。 |
| [DSH superagent 原型](https://github.com/ThorStarlord/dsh-superagent-prototype) | 研究级 GitHub/可选 Feishu 请求接入、准入策略、Ticket、Assignment、DSH worker Session、隔离的 Ticket 目录及操作员交接。 | 原型机制并不代表生产级验证，也不等同于 Dark Factory 的授权模型。 |
| 原生 Codex 与 Claude Code | 各自的产品指令、账号认证、模型、sandbox/权限决策和执行语义。 | DSH 委派不会抹平或统一这些原生控制。 |

名称相似不代表语义等同：[DSH Goal](../packages/goal/goal/README.zh.md) 保存单个 Session 的目标，但自身不调度工作；Dark Factory 的 `GoalRevision` 则记录获授权的产品意图。[DSH Workflow](../packages/workflow/workflow/README.zh.md) 协调调用方拥有的单次脚本运行；Dark Factory Campaign 则跨执行过程接纳状态转移、证据并处理恢复。[DSH Team](../packages/team/agent-team/README.zh.md) 在共享 checkout 中持久化采用比较并交换的任务看板；Dark Factory Delegation 限制允许授权哪些具有后果的 Campaign。Session 日志用于重建模型可见的历史；Campaign 日志记录不同的决策、权限与已接纳证据。

## 尚未选定的架构关系

- **A. 独立 Harness：** DSH 与 Dark Factory 可独立演化，保留各自原生优势并减少耦合；代价是分离的操作流程与知识交换，集成时不能暗中改写对方状态。
- **B. 分层集成：** Dark Factory 可继续拥有持久任务，并调用有界 DSH 执行，从而利用原生 Codex/Claude 路径；前提是具有类型约束的请求/结果/证据适配和明确的授权映射，而不是共享数据库或默认认为目标相同。
- **C. 选择性整合：** 未来的 DSH 插件可移植已验证的 Dark Factory 能力并淘汰真正重复的部分，以减少操作碎片；在退役任何现有权属之前，必须逐项确认能力对等、迁移、受保护转移设计，并显式作出替换决策。

这些只是可能的关系，不构成排名或实施授权。

## 指令、共享 Skill 与授权

[DSH 工作区指令](../packages/context/agent-instructions/README.zh.md) 读取用户级、项目级 `AGENTS.md` 和 `CLAUDE.md` 候选文件及本地覆盖文件；所检查的 fork 根目录中两份文件内容完全相同。因此，仅凭文件名不能推断冲突。Codex 和 Claude Code 仍遵循各自原生的指令与权限机制，目标仓库规则始终约束在该仓库中的工作。不同 host 的 hook、审批和会话标识默认不能互换。

Sensemaking Skill 应保持一个规范来源。DSH 可以使用共享 `.agents/skills` 目录或配置的 `customSkillDirs`；须分别验证原生 host 的发现机制，避免维护独立编辑的副本。**预期授权规则：**父 agent 不应委派自己不拥有的权限。**未经验证的执行约束：**原生 provider 使用各自 host 的凭证、权限模式和 sandbox 控制；本次勘察未证明父 agent 的权限限制会约束 worker 的实际操作。验证之前应采用保守的原生权限和只读任务。

两个原生 bundle 都不使用交互式人工提问，只返回选定的最终文本或安全诊断，而非完整子任务活动流。它们可能修改相同工作目录，不会自动撤销副作用；并行写入前必须显式隔离 worktree 或文件路径。初期应顺序执行明确选择的低风险任务。

## 开发与验证

根据[根目录清单](../package.json)选用兼容的 Node.js 和 pnpm 版本，并依照[开发指南](development.zh.md)进行 checkout 和安装。修改本文档时，应依照[双语文档约定](i18n/README.zh.md)维护中英配对文件和一致性记录；在宣称验证完成或合并之前运行[仓库文档检查](AGENTS.md)。

特定运行的修订标识、环境探测、实际执行命令、CI 状态和阻塞原因应保存在 PR 验证记录中，而非这份长期维护的架构参考文档。

## 已完成的 Windows 多模型试点

所有者确认的 Windows 试点通过现有 DSH 集成执行了多模型委派。完成试点证明了连接能力，但不证明不同 provider 共享会话、认证、权限策略、工作区隔离或权限。

## Dev Note

待解问题：真实使用后 A/B/C 哪种关系适合、已安装的原生 host 版本能否以相同方式使用共享 Skill 目录、哪些执行事实能够成为持久语义证据，以及未来任何整合是否值得迁移现有 Dark Factory 状态。路线图记录了这些决策，但没有选定集成关系。
