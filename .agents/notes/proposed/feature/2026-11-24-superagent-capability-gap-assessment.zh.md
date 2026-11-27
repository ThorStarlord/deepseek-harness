# Agent Note: Superagent capability gap assessment

Status: proposed

[English](2026-11-24-superagent-capability-gap-assessment.md) | 中文

## 问题

所有者当前的产品目标是打造个人 DeepSeek Superagent，用于跨代码库协调持久化的编码 Session。DeepSeek Harness 已提供许多所需的执行和持久化基础能力，但这些能力由不同组件管理，并拥有不同生命周期。具备这些基础能力，并不代表某个中心 Session 已能通过集成方式发现、分派、监督和协调其他无关 Session 中的工作。

现有的[模块化编码环境路线图](2026-11-10-modular-coding-environment-roadmap.zh.md)已将多代码库编排和持久化委派工作列为优先方向。本评估根据更明确的 Superagent 目标，收敛下一项责任范围。它是基于证据的建议，不是替代路线图，也不授权更改提供方控制。

## 提案

将 Superagent 保持为产品，并通过组合 DSH 现有的 Session、Activity、Workspace、查询和执行服务来构建。将 Sensemaking Skills 用作推理方法，而不是另一个运行时控制器。让 Codex 和 Claude Code 继续使用各自原生运行时。保持 Dark Factory 独立。

中心协调器应是普通的 DSH 根 Session。Activity 提供持久化的用户意图和选定的项目上下文。Workspace 标识已注册的代码库上下文。Session 仍负责自身历史、Agent 和运行时权限。缺少的是“责任”关系：它将一个范围明确且经用户批准的任务绑定到其 Activity、选定代码库上下文和一个或多个具体执行 Session，并为后续重新进入保留带来源归属的进度与结果。

### 当前能力图谱

以下分类描述 canonical master 及其文档所记录的执行证据。“已集成”不代表完整的 Superagent 体验已经得到演示。

| 能力 | 当前状态 | 产品限制 |
|---|---|---|
| Activity 和关联 | 已集成；持久化 Activity 可关联选定的 Workspace 和 Session，并保留注释、委派报告、交接、评审和战略事件。 | 关联不会发现或监督 Session，Activity 范围也不授予访问权。参见 [Activity 契约](../../../../packages/home/activity/README.zh.md)。 |
| Session 访问 | 已集成的底层能力；Session Controller 为 Web 客户端提供列表、搜索、历史、状态、创建和提示操作。 | API 是受访问控制的客户端操作，不是面向模型的跨根协调器。可选的 Session Query 模型工具为只读，并仅允许访问工作目录完全相同的其他 Session。参见 [Session Controller](../../../../packages/api/session-controller/README.zh.md) 和 [Session Query 工具](../../../../packages/experimental/tool-session-query/README.zh.md)。 |
| DSH 原生子 Agent | 已集成；同一根节点及其可继续的后代可以被发现、消息联系、中断和冷恢复。 | 这些操作局限于一个子 Agent 树，不能协调无关的根 Session。参见 [Subagent](../../../../packages/subagent/subagent/README.zh.md)。 |
| Team、Workflow、Goal 和 Job | 已集成的基础能力，生命周期彼此不同。Team 在一个子 Agent 树中协调共享任务板；Workflow 执行前台脚本扇出；Goal 保存单个 Session 目标；Job 属于提供服务的 Session。 | 这些能力都没有提供跨独立根 Session 的持久化 Activity 责任生命周期。参见 [Team](../../../../packages/team/agent-team/README.zh.md)、[Workflow](../../../../packages/workflow/workflow/README.zh.md)、[Goal](../../../../packages/goal/goal/README.zh.md) 和 [Jobs](../../../../packages/jobs/jobs/README.zh.md)。 |
| 跨代码库分析 | 已集成只读操作，支持恰好两个选定且已注册的本地 Git Workspace，并需要明确批准；每个代码库由独立子 Session 检查。 | 它不协调写入，也不提供涵盖三个代码库的统一责任工作流。参见[多代码库分析](../../../../packages/workspace/tool-multi-repository/README.zh.md)。 |
| Codex 和 Claude Code | 已集成一次性委派，并保留原生身份验证和权限处理。 | 当前 DSH 适配器不提供继续、恢复、检查 transcript 或回滚能力。参见[分支基础](../../../../docs/fork-foundation.zh.md)。 |
| 战略推理 | 明确的 Activity 评估流程会加载 Sensemaking Skills，并保存带来源归属的建议性简报。 | 确定性能力证据不能证明实时战略效果。建议不等于分派或执行权限。参见[Stage 2A 提案](../architecture/2026-11-22-native-activity-strategic-briefs.zh.md)。 |
| 战略重新进入 | 独立的 Stage 2B 实现仍在 canonical master 之外接受评审。 | 它处理已保存简报的重新考量，并不是从 canonical master 发现或协调 Session 的前置条件。 |

“Activity 关联 Session”这一关系只确立了已保存关联。Activity 契约没有承诺协调器可以检查或控制这些 Session。“Session Controller 可以向 Session 发送提示”这一关系仅在经过身份验证的客户端路由中成立；这并不代表模型有权提示其他根 Session。推荐的能力缺口基于这些区别，而不是声称 DSH 缺少 Session 或委派能力。

### 用户工作流评估

| 场景 | 当前可用能力 | 尚缺能力 |
|---|---|---|
| 比较 Auteur、Sensemaking Skills 和 DSH | 用户可以注册本地 Workspace，并明确批准只读的成对分析。现有操作每次支持两个代码库。 | 一次覆盖三个代码库、带来源归属的评估，并综合当前性、跨代码库机会和有依据的下一项责任。 |
| 协调并行实现 | DSH 可以在根树中启动子 Agent，并使用 Team 或 Workflow；独立 Session 可通过 Web 客户端管理。 | 中心模型的任务分派路径、安全选择现有根 Session、持久化责任身份、进度观察、依赖处理以及跨 Session 的结果归属和协调。 |
| 重启后恢复项目状态 | Activity、Session、Workspace、委派和战略记录都会持久化。用户可以打开 Session 并检查历史。 | 一个 Activity 级视图能够汇总其 Session 的活动中、已报告、阻塞、不确定、已验证和已接受工作，而不需要手动重建各次对话。 |
| 继续现有 Session | Web Session Controller 可以列出、搜索、打开并提示普通 DSH Session。DSH 子 Agent 控制可继续同一树中符合条件的成员。 | 中心协调器无法从模型层面安全识别并继续正确的无关根 Session；原生 Codex 或 Claude Code Session 也无法被表示为可恢复的 DSH Session。 |

对于指定的 Auteur 场景，本评估使用了公开 main 分支的 README，因为本地 Auteur 检出包含无关的未跟踪文件；该工作树保持未更改。Auteur 将自身描述为用于长篇叙事创作的本地优先作者 Agent；Sensemaking Skills 提供基于来源的代码库推理；DSH 提供执行和持久化。本次评估没有执行实时的三代码库分析。

### RELATE 评估与瓶颈

主张：“在 canonical DSH 产品组合中，中心模型可以发现并向选定代码库中的无关根 Session 分派工作。”范围：canonical master 中当前面向模型的工具，以及 Session、Activity、Workspace 和 subagent 契约。

现有声明的契约提供 Activity 关联、Session Controller 操作、同一子 Agent 树内的控制，以及一个只读的双 Workspace 分析工具。实现通过经过身份验证的客户端 API 提供 Session Controller 的跨 Session 提示路径；面向模型的 Session Query 包为可选只读工具，并受工作目录范围限制。当前源代码和集成使用证据都没有确立 Activity 关联责任能够协调无关根 Session。缺口位于集成协调产品，而不是基本 Session 持久化、Workspace 身份或 Agent 执行能力。

因此，首要瓶颈是缺少持久化的“责任到执行”关系及保留主体身份的中心交互。Session 发现和进度观察是该垂直能力中的首批实现步骤。提供方继续能力是更后续、因提供方而异的限制，不应成为虚构统一 Session 生命周期的理由。

### 建议的首个垂直能力

基于 canonical master 构建**以 Activity 为范围的 DSH Session 责任协调**。协调器使用一个明确选定的 Activity，以及明确选定的已注册 Workspace 和关联 Session 集合。它会恢复当前 Session 事实，提出一项范围明确的责任，要求用户确认具体目标 Session 和任务，通过目标 Session 现有的 DSH 路由执行，观察结果，并保存带来源归属的记录，供另一个协调器 Session 恢复。

首个垂直能力只协调 DSH 原生根 Session。跨根检查和派发必须由 Client 中介：模型提出目标和任务，Client 显示确切请求并等待用户明确确认，然后由经过身份验证的 Client Remote 使用用户主体和目标资源检查调用现有 API Gateway 路由。注入协调器的任何 Session 事实都必须注明来源并记录在其 Session 历史中。不得从模型工具直接调用 Host 服务、伪造所有者主体，或将协调器的权限继承给目标 Session。保留每个目标 Session 的 preset、写入者所有权和已配置执行权限。不得创建 Session、委派给外部提供方，也不得自动重试结果不确定的提示。如果在现有主体和资源策略下无法实现经过确认的 Client 往返交互，首个垂直能力必须止于只读发现和建议；不得声称已实现跨根派发。

在 Activity 下持久化稳定的责任身份和仅追加的生命周期事实。每条事实应标明发起协调器的 Session、获批的 Workspace 和目标 Session、请求及提供方来源、观察到的状态或报告、证据序号或来源引用，以及不确定性。先将现有 Activity 委派和交接契约与这一确切生命周期进行比较，再确定具体存储方式；只有当现有契约无法准确表示责任生命周期，且不会将一次性报告与持续的根 Session 混为一谈时，才添加独立的版本化领域。

首个版本应支持跨至少两个代码库观察和继续选定的 DSH 根 Session，并明确记录代码库身份和当前性。当所有选定代码库均可访问且获得授权时，应将 Auteur、Sensemaking Skills 和 DSH 三代码库场景作为资格演示。只有当不同责任面向不同 Session，且代码库或工作树所有权可避免写入冲突时，才允许并发执行。

### Stage 2B 与权限

Stage 2B 的战略重新进入实现仍是独立的未合并工作。首个协调垂直能力可以直接从 canonical master 开发，无需复制或依赖其分支。若 Stage 2B 日后集成，协调器可以将其建议性决策作为证据重新检索，但仍须判断该决策是否适用。

本建议不授权自动派发、更改权限、修改代码库、集成或接受工作。用户必须批准发送给其他 Session 的每项任务。提供方报告仍与验证和用户接受相区分。用户可见的实现仍须遵循当前有效的产品/设计评审政策。

### Superagent Prototype 复用评估

[DSH Superagent Prototype](https://github.com/ThorStarlord/dsh-superagent-prototype/tree/6337fc823ce20251c8de8085948165c81aaa701e) 已实现中心 Session、持久化 Ticket 和 Assignment、工作者状态报告、重启恢复、事件准入、通知和管理面板。它的 bundle 面向一个配置的 GitHub 仓库，声明依赖 DSH `^0.2.1-alpha.2` 与 Cordis `4.0.5-alpha.1`，会创建自己的工作者 Session，且工作者 preset 中包含 shell 访问。它的 `ready` 报告可以结束原型 Ticket。这些生命周期和权限不能替代所选 DSH Activity、任意现有根 Session、经身份验证的 Client 分发或目标 Session 自有的授权。

在 DSH 的权限所有权结构中复用工作者报告的概念。Activity 责任记录继续作为唯一的分配身份与最终结果记录。目标根 Session 只能为分配给它自己的、已准入或结果未确定的责任追加有界的进展、等待、待审查、受阻或失败自我报告。每份报告都引用目标的 `tool/call` 事件，并保存在单独的版本化侧域中，因此严格的责任版本 1 事实不变。DSH 不会据此推断完成、验证、接受、调度或通知。本实现不复制 Prototype 代码或包依赖；Prototype 使用 MIT 许可证，本记录保留已检查的源版本以便追溯。

此适配只提供目标自我报告的中间进展。Prototype 整体的事件准入、Ticket 审核、工作者创建、并发调度、后台作业监控、注意事项路由、恢复控制器和管理面板仍未集成。不能根据此项针对性使用声称整个 bundle 的兼容性或安全性已获资格认定。此 DSH 行为变更会作为后续 PR 叠加在跨 Session 协调 PR 上；集成仍需通过该 PR 自身的要求和当前有效的独立人工产品/设计审查。

## 已考虑的替代方案

**只采用以 Session 为中心的协调**可以复用 Session 身份和继续能力，但会让用户意图和跨项目上下文继续散落在不同对话中。Session 应继续作为执行所有者，而不是取代 Activity 的持久化目标。

**将 Activity 变成执行控制器**会使 Activity 承担进程和提供方生命周期。当前 Activity 契约有意保存意图和归属记录，而不负责调度或授予权限；将它变成控制器会把具有不同失败模式和授权规则的责任合并起来。

**用 Team 或 Workflow 作为中心协调器**可以复用有用的扇出机制，但二者都在单个调用者拥有的树中运行，也不会为无关根 Session 建立持久责任状态。它们仍适合作为已选责任内部的执行基础能力。

**整体导入 DSH Superagent Prototype 或 Dark Factory**会在缺口被证明需要之前引入第二套请求接入或任务权限模型。Prototype 是研究参考，不是产品。Dark Factory 继续独立拥有自己的任务状态和受保护转移。只有在 DSH 契约确有需要时，才复用稳定任务身份和操作员交接等概念；不要整体移植任一系统。参见[分支基础](../../../../docs/fork-foundation.zh.md)。

**增量组合**更可取，因为它使用 DSH 现有组件来分别管理 Activity 意图、Workspace 身份、Session 执行、查询和提供方控制，只增加缺失的持久责任关系与中心交互。

## 验收标准

- 中心 DSH Session 可以选择一个 Activity，并明确指定至少两个已注册的代码库 Workspace 及相关的 DSH Session。
- 协调器可以检查获准的 Session 状态和带来源归属的近期结果，而不创建或唤醒无关 Session。
- 协调器可以比较代码库上下文，并基于证据、替代方案、不确定性和代码库范围提出有界的下一项责任。
- 用户确认确切责任和目标 Session 之前，不得发送任务；Activity 关联或建议本身不授予执行权限。
- 跨根状态和提示操作必须通过由 Client 中介、经过身份验证的 API Gateway 请求执行，并保留用户主体和目标资源检查。模型不得直接调用 Host Session Controller 方法，也不得通过工具组合获取所有者身份。
- 已确认的任务通过目标 Session 受访问控制的提示路径送达，并保留该 Session 的原生身份、preset、写入者所有权和权限。返回给协调器的任何 Session 事实都必须注明来源，并且可以从其日志中重建。
- Activity 保留稳定的责任身份及仅追加的状态与结果事实；另一个 Session 可在应用重启后恢复这些信息，且不会重新发送任务。
- 未知的送达或持久化结果继续标记为不确定，且不会触发自动重试。提供方报告仍与已验证结果和用户接受相区分。
- 组装后的应用演示选定的 Activity、代码库和 Session 范围、确认、进度或失败、带来源归属的结果，以及另一 Session 后续恢复。所有来源均可访问并获准时，应演练三代码库场景。
- 首个垂直能力不得恢复外部 Codex 或 Claude Code Session、创建 Campaign 或 Prototype Ticket、更改受保护策略、合并其他代码库，也不得在缺少比较证据时声称战略判断有所改进。

## 风险

- 如果模型工具直接调用 Host 服务，为其他根 Session 提供提示的路径可能绕过客户端访问检查；实现必须保留经过身份验证的主体和目标资源授权。
- 目标 Session 运行期间，持久化状态可能已经过期。协调器必须显示观察时间和来源序号，并区分未知与已完成结果。
- 两个 Session 可能修改同一个代码库或分支。初始工作流必须要求明确的工作树所有权，或串行处理冲突任务。
- 现有只读代码库工具观察实时工作树，而不是不可变快照。分析期间的源代码变化必须继续显示为不确定性。
- Codex 和 Claude Code 保留其原生 Session 及权限语义。首个垂直能力排除跨运行时继续功能，这限制了范围，但仍留下真实的后续产品缺口。
- 当前政策仍要求用户可见变更接受合格的独立人工产品/设计评审；Agent 评估不能取代人工评审。
- Stage 2B、Issue #55 和 Dark Factory 治理仍是独立事项。本评估不对其作出决定。
