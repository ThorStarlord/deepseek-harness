---
description: "通过 Web 命令 composer 创建、列出并重新打开已保存的 Home Activity，且不启动其目标。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-home-activity

[English](README.md) | 中文

## 概述

在 Web composer 中使用 `/activity` 创建带目标和描述性边界的命名 Activity、列出已保存的 Activity，或重新打开其已保存详情。此命令无需模型往返，也不会启动已保存目标。它需要 `ctx.commands` 注册表和 `ctx.homeActivities` 服务。

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

### 命令参考

| 命令 | 行为 |
|---|---|
| `/activity create <JSON>` | 保存名称、目标，以及包含 `inScope` 和 `outOfScope` 字符串数组的 `boundaries` 对象。至少需要一项 `inScope` 内容。 |
| `/activity list` | 按创建时间从新到旧列出已保存 Activity 的名称和稳定 id。 |
| `/activity open <activity-id>` | 显示已保存目标和描述性边界。 |

创建请求最多为 16,384 个 UTF-8 字节。如果存储错误导致提交状态不确定，命令会提示用户先列出 Activity 再重试。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

此命令注册为人工命令，而非模型工具。处理器通过 `ctx.homeActivities` 持久化记录；它不会创建 Session turn、Goal、Workspace project 或执行请求。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 命令注册、输入校验与用户可见结果 |
| [`tests/command.spec.ts`](tests/command.spec.ts) | 命令行为、安全失败与不执行断言 |

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

此命令由用户调用，不会增加模型可见输入或模型请求。

#### KV 缓存影响

无；此命令不会创建模型请求或改变模型上下文。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

此命令仅保存和显示意图。

- Web composer 是唯一交互界面；没有独立 Activity 浏览器或原生 Desktop 命令。
- 创建输入使用 JSON 文本，且无法通过此命令编辑或删除 Activity。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
