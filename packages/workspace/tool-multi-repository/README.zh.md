---
description: "协调两个选定的本地 Git Workspace 中的工作，并审查每个子 Session 归属明确的结果和 Git 证据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-multi-repository

[English](README.md) | 中文

## 概述

`coordinate_repositories` 会为恰好两个选定的 Workspace Git 仓库各启动一个全新的进程内 DSH 子 Session。每个子级都在从捕获的提交创建的独立干净克隆中工作，变更会保留以供审查。父级会收到带有源仓库身份、子运行 id 和 Git 证据的两项结果，然后可在一条答复中协调这些变更。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [深入探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当用户发起的对话需要协调两个已注册的本地 Git Workspace 中的一项编码任务时，可加载此插件。

### 适用场景

当调用方可以指定恰好两个仓库根目录，并需要独立的子 Session、克隆和结果时，选择此插件。Web 应用的标准配置已挂载此插件；其他组合必须提供 Workspace registry、沙箱文件系统和 shell、subprocess 与 sandbox policy 服务，以及声明支持 `permissionRoot` 的进程内 subagent 提供方。

### 最小配置

在提供这些服务的现有 DSH 组合中添加此插件项：

```yaml
- name: '@deepseek-ai/dsh-tool-multi-repository'
  config:
    providerName: spawn
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providerName` | `spawn` | 用于两个仓库子级的进程内 subagent 提供方 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-multi-repository)列出所有可接受的字段。

两个 Workspace 根目录都必须是绝对路径、已注册、本地 Git 仓库根目录，且工作树干净；它们还必须具有不同的 Git common directory。两个子级共享同一任务，但各自只在为所选仓库准备的克隆中读取和修改文件。

插件会将克隆存储在 `DSH_HOME` 下，移除每个克隆的 `origin` 远程，并从捕获的 `HEAD` 创建唯一分支。它保留源检出不变，也不会将结果合并回源仓库。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

协调器会在克隆前验证仓库身份和 Git 状态。它准备两个独立克隆，为每个克隆启动一个由调用方收取结果的 DSH 子 Session，并将该目录固定为权限根；等待两项结果后，它会把独立的仓库结果行返回父级。

Subagent 提供方能力会将子 Session 不可变的 `cwd` 设为其 DSH `workspace-write` 根目录。协调器仅在沙箱报告完整强制执行且没有全局额外可写目录时执行可写 Git 设置，因为这两种情况都可能在所选克隆之外授予写入权限。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 注册工具、验证所选仓库、准备克隆、委派子 Session 并返回 Git 证据 |

</details>

-----

<a id="further-exploration"></a>
## 深入探索

- [Workspace registry](../workspace/README.zh.md) — 已注册的项目身份和本地目录记录。
- [Subagent 服务](../../subagent/subagent/README.zh.md) — 子 Session 生命周期与提供方能力。
- [Sandbox policy](../../sandbox/sandbox-policy/README.zh.md) — 每个 Session 的文件权限和平台行为。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-multi-repository) — 模型可见参数和结果字段。

-----

<a id="model-experience"></a>
## 模型体验

### 协调工具

#### 模型看到的内容

每条父级请求都会包含 `coordinate_repositories` 工具 schema，参数为恰好两个 Workspace 根目录和一项任务；生成的[工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-multi-repository)列出精确参数和结果字段。调用会为每个仓库返回一行，包含其源 Git 身份与提交、子 Session 和运行 id、克隆分支、执行结果、最终 Git 状态及子级报告。

##### Tool call example

```markdown
User request: "Make the same check in /workspace/api and /workspace/cli."
Tool arguments: {"repositories":["/workspace/api","/workspace/cli"],"task":"Add the same check and report each repository's diff."}
```

#### Token 影响

插件启用时，每条请求都会包含固定 schema 和简短说明；调用会将任务、两行结果和子级报告加入父对话。

#### KV Cache 影响

插件注册保持不变时，schema 会留在稳定的请求前缀中。工具调用和结果会追加到对话；更改活动插件组合可能使受影响请求前缀的缓存复用失效。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

此工具受现有 DSH 组合提供的权限和执行提供方限制。

- **文件读取范围仍然较广** — DSH 允许读取 Session 根目录之外的路径，因此选择仓库不能阻止子级读取其他路径。
- **临时路径仍有写入权限** — 当前 DSH 沙箱允许写入操作系统临时目录，包括其中未注册的仓库。
- **写入支持取决于强制执行能力** — Windows ACL 报告强制执行不完整，工具会拒绝准备克隆；原生 Codex 和 Claude Code 提供方未声明 DSH `permissionRoot` 能力。
- **变更保留在克隆中** — 两个源仓库开始时都必须干净；工具不会创建 pull request、合并分支或修改源检出。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
