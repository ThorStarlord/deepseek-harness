# Agent Note: 原生 Activity 战略简报

Status: proposed

[English](2026-11-22-native-activity-strategic-briefs.md) | 中文

## 问题

Home Activity 会跨 Session 保存用户发起的工作，Sensemaking Skills 则提供基于来源的战略推理。两者没有原生连接时，用户必须在 Session 之间手动携带仓库发现和建议；另建战略控制器又会重复现有 Skills 及其检索方法。

## 提案

将每份 Activity Strategic Brief 保存为独立、仅追加的版本 1 Activity 域。用户显式请求 `/activity assess` 后，系统应加载现有 Sensemaking Skills，并在另行获得批准后使用现有只读多仓库协调器；保存由 Agent 撰写的建议，并附上 Activity、Session、所选 Workspace、Skill 摘要、来源引用和协调器报告的修订。记录器应将 Workspace 身份、修订和观察时间绑定到来源 DSH Session 中匹配的协调器结果，同时明确来源内容和发现仍由 Agent 负责。打开 Activity 只显示历史简报，不会重新评估。该操作不应更改活动 Agent 的工具、提供方权限或执行配置。

## 考虑过的替代方案

**把评估保存到 Activity 或用户备注记录中？** 不采用，因为战略分析由 Agent 撰写并带有来源归属；它必须与用户意图和用户撰写的更正分开。

**实现第二个原生战略控制器？** 不采用，因为现有 Sensemaking Skills 负责分析方法，现有协调器负责经批准的只读多仓库访问。在出现实际限制前，第二个控制器会重复这些职责。

**导入 Superagent 或 Dark Factory 编排？** 延后，因为 Activity Strategic Brief 只是建议；Ticket 或 Campaign 准入与执行权限不属于这次可逆的初始集成。

**通过活动 Agent 的通用文件工具读取仓库？** 不采用，因为这些工具无法确立所选 Workspace 范围、来源修订或协调器另行请求的一次性读取批准。

## 验收标准

- 用户在评估前明确选择一个已保存 Activity 和恰好两个已注册 Workspace。
- 评估使用现有 Sensemaking Skills 和经批准的只读协调器；来源不可用时，结果保持明显的不完整状态。
- 持久记录保留来源身份、DSH 报告的修订、观察到的工作树状态和各仓库的观察时间，不复制仓库内容或 Session 转录。
- 后续 Session 可以检查先前建议及其证据；来源变化或不可用时应标示不确定性。
- 若选定 Workspace 存在未提交变更、观察期间发生变化、不可用或来源稳定性未知，简报不得标为完整。评估和重新打开不会以程序方式启动实现提供方、创建 Goal、Ticket 或 Campaign，也不会更改权限。
- 发现仍是 Agent 撰写的建议，并与独立验证和用户接受分开。

## 风险

活动 Agent 保留现有工具权限；评估指令不会创建硬性执行沙箱。协调器元数据记录 DSH 报告的内容，但不会独立验证仓库内容、引用或战略结论。观察期间来源发生变化或来源稳定性未知时，记录必须保持不完整。后续建议会保留历史简报；打开 Activity 不会证明其当前仍适用。
