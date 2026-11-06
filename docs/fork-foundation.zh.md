# 个人 Fork 基础：多 Harness 架构选项

[English](fork-foundation.md) | 中文

## 概述

此个人 fork 探索将 DeepSeek Harness 作为模块化编程环境，与原生 Codex、原生 Claude Code、可移植的 Sensemaking Skills 以及可选的持久任务协调能力并用。本文件不选择永久的软件工厂控制器，不推翻其他仓库已接受的决策，也不承诺统一 agent 会话。

首个可用体验是显式选择三条执行路径进行有界委派，并根据真实仓库结果审查结论。新增自动路由、适配器、存储或编排不属于本次基础工作。

## 可复用能力

| 执行路径 | 现有能力 | 初期使用限制 |
| --- | --- | --- |
| DSH 原生 agent | [受管理 DSH subagent](../packages/subagent/subagent/README.zh.md) 可以启动、fork、通信并冷恢复可继续的进程内 agent；独立的 [DSH SDK provider](../packages/subagent/subagent-dsh-sdk/README.zh.md) 会启动另一套 Harness 运行时。 | 两种 DSH 后端的会话和工具可见性不同。 |
| 原生 Codex | [Codex bundle](../packages/subagent/subagent-codex/README.zh.md) 使用固定版本的原生 app-server 进程和单个临时 thread/turn，提供 `subagent_codex`。 | 仅一次性执行；认证和模型设置归原生系统；无子任务 transcript、原生恢复或回滚。 |
| 原生 Claude Code | [Claude Code bundle](../packages/subagent/subagent-claude-code/README.zh.md) 使用固定版本的原生 SDK/CLI 查询，提供 `subagent_claude_code`。 | 仅一次性执行；认证和设置归原生系统；无子任务 transcript、原生恢复或回滚。 |
| 核心环境 | [基于 base 的 Profile](architecture.zh.md) 组合 Cordis 插件、模型适配器、文件系统和 shell provider、sandbox 策略、审批以及持久 Session 日志。 | Profile 层会整体替换目标配置行；插件存在不等于已经验证认证或 sandbox。 |
| 可复用认知能力 | [文件系统 Skill provider](../packages/skill/skill-filesystem/README.zh.md) 扫描项目、自定义和用户目录中的 `SKILL.md`，按需加载正文。 | DSH 能发现 Skill，并不证明原生 Codex 与 Claude Code 的发现或执行方式完全相同。 |

最小候选方案复用现有基于 base 的 Web 或 headless Profile、内置 DSH subagent 工具及两个可选的原生 bundle。通过受支持的 Profile/插件机制启用 bundle；不要另造启动器，也不要绕过 `dsh` Profile 直接挂载应用。

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

Sensemaking Skill 应保持一个规范来源。DSH 可以使用共享 `.agents/skills` 目录或配置的 `customSkillDirs`；须分别验证原生 host 的实际发现机制，避免维护三份独立编辑的副本。即使原生运行时技术上能申请更多权限，父 agent 也必须先授权有界任务，并确保子 agent 的权限不高于父 agent。

两个原生 bundle 都不使用交互式人工提问，只返回选定的最终文本或安全诊断，而非完整子任务活动流。它们可能修改相同工作目录，不会自动撤销副作用；并行写入前必须显式隔离 worktree 或文件路径。初期应顺序执行明确选择的低风险任务。

## 可复现性记录

检查日期：2026-11-06。GitHub API 显示 fork `master` 与上游 `master` 处于相同的起始修订；不可变标识记录于基础 PR 的 base 元数据和描述中，而不直接写入此文件，以符合仓库引用检查规则。远程比较没有发现 fork 分叉。当前环境无法检查用户本人本地 worktree 或未提交的修改。

| 观察项 | 结果 |
| --- | --- |
| 可用执行主机 | Linux x86_64；`node --version` 返回 `v22.16.0`；`git --version` 返回 `2.47.3`；`corepack --version` 返回 `0.32.0`。 |
| 包管理器 | 未安装 `pnpm`；根 `package.json` 要求 Node `>=24.9.0` 和 `pnpm@11.28.5`；DSH 根版本为 `0.2.2-rc.1`。 |
| 本地 checkout | 没有挂载 fork checkout；`git -C /mnt/data status --porcelain` 因目录不是 Git 仓库而失败。Git 网络连接无法解析 `github.com`。 |
| 实际执行的验证 | 已通过 GitHub 检查源文档、包清单、相关仓库文档、当前分支元数据和 provider 约定；已执行 Node/Git/Corepack 版本命令。 |
| 未执行的验证 | 未运行 `pnpm install --frozen-lockfile`、`pnpm run test:docs`、`pnpm run doc-sync`、`pnpm run lint`、`pnpm run build`、`pnpm dsh --profile web --dump-config` 或模型执行；不能宣称这些检查通过。 |

在能访问 checkout 且安装兼容 Node/pnpm 的机器上，根据仓库现有指令依次执行 `pnpm install --frozen-lockfile`、`pnpm run test:docs`、`pnpm run doc-sync`、`pnpm run lint`、`pnpm run build` 和 `pnpm dsh --profile web --dump-config`。只有在 Git 外部配置凭证后，才使用现有源码启动方式执行有界模型任务，并保留输出和故障诊断。本段是复现步骤，不是已执行的测试记录。

## 下一项有界职责

使用现有 DSH 子 agent 路径及两个原生 subagent bundle 配置并验证一个个人 DSH Profile，不修改 provider 代码。通过 `--dump-config` 确认解析结果；在各自安全的工作区内，显式选择每个 provider 各执行一个只读仓库问题；将回答与源码核对；记录认证阻塞、原生审批行为、可观察的 Session 事件和工作树未修改状态。不要引入路由器、共享会话数据库、自动软件工厂派工或并发写入委派。

## Dev Note

待解问题：真实使用后 A/B/C 哪种关系适合、已安装的原生 host 版本能否以相同方式使用共享 Skill 目录、哪些执行事实能够成为持久语义证据，以及未来任何整合是否值得迁移现有 Dark Factory 状态。这些问题均未由本次纯文档勘察解决。
