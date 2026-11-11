---
description: "协调两个选定的本地 Git Workspace 中的只读分析，包括当前暂存区与工作区状态。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-multi-repository

[English](README.md) | 中文

## 概述

`coordinate_repositories` 会为恰好两个选定且已注册的本地 Git Workspace 各启动一个只读 DSH 子 Session。每个子 Session 检查自己的实时工作区，并将仓库、Session、运行、Git 状态和源证据归属返回给同一个父对话。此工具不会修改任何仓库。

## 目录

- [使用本包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [深入探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

当用户发起的对话需要跨恰好两个已注册的本地 Git Workspace 进行只读分析时，可加载此插件。

### 选择与授权

两个选定路径都必须是绝对路径、已注册的 Workspace 根目录，并且对应不同的 Git 仓库身份。检查仓库内容前，现有的一次性审批流程会请用户批准本次操作的两个确切根目录和任务。注册本身不授予访问权，只读访问授权也不会授予写入权限。

### 仓库状态

每个子 Session 都会收到一个仓库的根目录指令、当前分支与已提交的 `HEAD`、暂存路径、未暂存路径、未被忽略的未跟踪路径以及忽略文件数量。工作区读取会观察实时文件内容；暂存区读取使用 Git 索引。DSH 不会创建不可变快照，也不会暂存、藏匿、复制、提交、重置或清理源仓库。

结果会标明每个 Workspace 和 Git 目录、子 Session、运行、停止原因以及发现。结果还会报告观察时间段，以及最终 Git 和文件系统检查是否发现源状态变化。如果源内容已变化或无法重新检查，请将发现视为可能过时。

### 最小配置

在提供 `workspaceRegistry`、`fs`、`subprocess`、`sandbox`、`subagents`、`agentPresets` 和可由用户应答的审批服务的 DSH 组合中添加此插件：

```yaml
- name: '@deepseek-ai/dsh-tool-multi-repository'
  config:
    readOnlyAgentPreset: multi-repository-read-only
    providerName: spawn
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `readOnlyAgentPreset` | `multi-repository-read-only` | 为每个分析子 Session 挂载的纯 persona 预设 |
| `providerName` | `spawn` | 支持固定只读策略和可信子工具限制的进程内 DSH 提供方 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-multi-repository)列出所有可接受的字段。

Web 应用配置已提供只读预设和此工具。其他组合必须提供等效服务，以及明确声明同时支持只读策略固定和可信子工具限制的提供方。若提供方没有声明这些能力，或采用不同的原生权限契约，系统会拒绝启动。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节</summary>

父工具调用会先经过现有的一次性审批流程，然后才检查仓库。协调器验证两个 Workspace 的身份，并为每个根目录运行一个子 Session。每个子 Session 固定使用 DSH `read-only` 沙箱策略，只能使用 `repository_list_files`、`repository_read_file` 和 `read_staged_file`。它没有通用文件系统、shell、subprocess、写入、子代理委派或沙箱策略工具。

仓库读取工具会针对子 Session 选定的根目录检查每个请求路径，排除忽略文件和敏感文件路径，并限制返回的文件内容大小。协调器分别报告每个根目录的 Git 状态，并将两个工作者的结果返回给同一个父 Session。

在 Windows 上，ACL 沙箱报告部分强制执行，其受限令牌无法读取普通用户拥有的仓库文件。因此，固定且由内部构造的 Git 只读命令会通过主机 subprocess 提供方运行；子 Session 仍没有 subprocess 工具，也不能提供调用命令。这些 Git 读取在 Windows 上没有进程级沙箱约束。工具级文件读取仍限制在选定 Workspace 内，但这不等于进程级读取隔离。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 注册协调与仓库读取工具，验证选择，运行子 Session 并归属结果 |
| [`src/read-only-git-command.ts`](src/read-only-git-command.ts) | 限制内部 Git 命令并选择主机空设备路径 |
| [`tests/workflow.spec.ts`](tests/workflow.spec.ts) | 覆盖两个脏仓库、授权、工具限制、源变化、失败和取消 |
| [`tests/loader-composition.spec.ts`](tests/loader-composition.spec.ts) | 通过已发布的 headless profile 和 Loader 执行只读工作流 |

</details>

-----

<a id="further-exploration"></a>
## 深入探索

- [Workspace registry](../workspace/README.zh.md) — 已注册项目身份和本地目录记录。
- [Subagent 服务](../../subagent/subagent/README.zh.md) — 子 Session 生命周期和提供方能力。
- [Sandbox policy](../../sandbox/sandbox-policy/README.zh.md) — Session 权限和平台行为。
- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-multi-repository) — 模型可见参数和结果字段。

-----

<a id="model-experience"></a>
## 模型体验

### 协调工具

#### 模型看到的内容

父 Session 会为每个选定仓库收到一项结果。每项结果标明当前 `HEAD` 和分支、暂存区、未暂存区、未跟踪和忽略状态、子 Session 与运行、观察时间段，以及带有源证据的发现。子 Session 只会看到所选仓库的根目录指令，并通过受限读取工具检查实时工作区文件、索引版本和文件列表。

##### 工具调用示例

```markdown
User request: "Compare the parser integration in C:\work\api and D:\work\cli."
Tool arguments: {"repositories":["C:\\work\\api","D:\\work\\cli"],"task":"Analyze the parser integration and cite the relevant working-tree and staged source in each repository."}
```

#### Token 影响

插件启用时，每条请求都会包含 schema 和简短说明；调用会将各子 Session 的仓库归属结果加入父对话。

#### KV Cache 影响

插件注册未变时，schema 会保留在稳定的请求前缀中。工具调用和结果会追加到对话；更改活动插件组合可能使受影响请求前缀的缓存无法复用。

## 已知限制与延期工作
<a id="known-limitations-and-deferred-work"></a>

- **只能选两个根目录** — 一次调用仅接受两个不同的已注册本地 Git Workspace。
- **读取实时源内容** — 工作人员会随时间读取当前工作区和索引，而非不可变快照。并发编辑可能使发现过时；返回的状态检查只能尽力检测变化。
- **忽略文件和敏感文件** — 不会自动包含忽略文件内容；读取工具会排除敏感路径和 `.git` 元数据。
- **基于路径的读取限制** — 文件系统会检查解析后的路径是否位于各自选定根目录内，但其元数据无法识别硬链接别名。所选目录树中可能存在指向其他位置数据的内部硬链接，DSH 无法将其识别为外部文件。
- **Windows 进程隔离** — Windows ACL 强制执行不完整，因此固定 Git 检查命令以主机进程运行。子 Session 没有模型可调用的进程工具，但 Windows 不会在进程级限制这些内部 Git 读取。DSH 文件读取工具会检查选定根目录内的路径限制。
- **没有写入流程** — 此能力不会创建克隆，也不会修改源文件、索引或 Git 状态。写入委派仍不可用，须另行完成安全资格验证。

<a id="dev-note"></a>
### 开发备注

无。
