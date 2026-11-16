---
description: "通过 Web 命令 composer 创建、列出并重新打开已保存的 Home Activity，且不启动其目标。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-home-activity

[English](README.md) | 中文

## 概述

在 Web composer 中使用 `/activity` 创建、列出和打开已保存的 Activity，或明确地将一项任务委派给 DSH 原生 `spawn` 提供方。委派会启动单独的一次性子级 Session，并记录提供方报告的结果。Activity 目标不会自动执行。此命令需要 `ctx.commands`、`ctx.homeActivities`、`ctx.homeActivityDelegations` 和 `ctx.subagents` 服务。

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

Web 配置会将此命令与命令注册表及持久 Activity 服务一同加载。

### 何时选择

当用户需要为后续对话保存意图时，使用 `/activity`。当前 Session 的完成目标使用 `/goal`；Activity 不会启动或激活 Goal。

### 最小配置

此包没有配置字段。在已经提供这两个注入服务的组合中，添加此插件：

```yaml
- name: '@deepseek-ai/dsh-command-home-activity'
```

[命令注册表](../commands/README.zh.md)负责直接调用人工命令，[`dsh-home-activity`](../../home/activity/README.zh.md)负责持久记录。

启用委派的组合还需挂载 `@deepseek-ai/dsh-home-activity/delegations`、`@deepseek-ai/dsh-subagent` 和受支持的 DSH 原生提供方。当前命令支持 `spawn`。

### 命令参考

| 命令 | 行为 |
|---|---|
| `/activity create <JSON>` | 保存名称、目标，以及包含 `inScope` 和 `outOfScope` 字符串数组的 `boundaries` 对象。至少需要一项 `inScope` 内容。 |
| `/activity list` | 按创建时间从新到旧列出已保存 Activity 的名称和稳定 id。 |
| `/activity open <activity-id>` | 显示已保存目标、描述性边界和委派记录。 |
| `/activity delegate <activity-id> spawn <task>` | 保存请求，明确启动一个 DSH 原生子级 activation，并单独报告提供方结果。任务最多为 4,096 个 UTF-8 字节。 |

创建 JSON 最多为 16,384 个 UTF-8 字节。委派请求和拟请求的子级 Session id 会在启动提供方前持久保存；该 id 不代表已获准入。DSH 接受 activation 后命令即返回，结果记录在后台继续进行。启动被拒绝时记录为未准入。若准入状态不确定，请用 `/activity sessions` 检查拟请求的 id 并查看对应 Session，再决定是否重试；Session 记录缺失也不能证明启动失败。提供方输出按原样报告，不会标记为已验证或已接受。

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

模型体验通过显式的 `/activity delegate` 命令间接产生：该命令会使用所选提供方启动一个 DSH 原生子激活，并分别记录请求、DSH 准入和提供方报告，不会暗示结果已验证或被用户接受。

#### KV 缓存影响

无；委派任务使用独立子级 Session，不会修改父级上下文。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

Activity 范围说明描述请求的工作；它们不会限制子级工具或权限。访问由 DSH 当前运行时策略控制。

- Web composer 是唯一交互界面；没有独立 Activity 浏览器或原生 Desktop 命令。
- 创建输入使用 JSON 文本，且无法通过此命令编辑或删除 Activity。委派目前只支持 `spawn` DSH 原生提供方。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
