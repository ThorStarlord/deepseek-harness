---
description: "使用全新的只读 DSH reviewer 检查当前获授权的 Git 工作树。命令会分开展示暂存、未暂存和未跟踪证据，并报告分析期间实时源文件是否发生变化。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-code-review

[English](README.md) | 中文

## 概述

在工作目录位于获授权 Git 仓库的 Web 会话中运行 `/review`，即可让新的 DSH reviewer 检查暂存、未暂存和未忽略的未跟踪改动并给出问题发现。Reviewer 会收到仓库指令和有大小限制的源代码数据包，并且只能使用 Skill loader 工具。命令会报告仓库、分支、已提交版本、reviewer Session 和运行标识，以及分析期间实时源文件是否发生变化。它不会修改仓库文件或 Git 状态。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

启动 `dsh --profile web`，打开工作目录设为待检查仓库的会话，然后运行 `/review` 或 `/review <重点>`。Web profile 已挂载此命令和 `code-reviewer` preset。

### 何时选择本包

当你需要先报告问题、且不向 reviewer 提供 shell 或文件系统工具时，选择此命令。若任务需要完整探索源代码、运行测试或修改代码，请使用普通 DSH agent；`/review` 只向子 agent 发送有大小限制的改动数据包和仓库指令。

### 最小配置

Web profile 已包含该命令。其他 Cordis 组合可以通过插件行挂载本命令，并且必须同时提供 Web profile 所用的 `code-reviewer` preset 和 Skill loader。

```yaml
- id: command-code-review
  name: '@deepseek-ai/dsh-command-code-review'
  config:
    evidenceReminder: true
```

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `maxPacketBytes` | `524288` | 渲染后的源代码数据包大小上限，最高 8 MiB。 |
| `maxChangedFiles` | `100` | 纳入检查的改动文件数上限，最高 1,000。 |
| `maxInstructionBytes` | `16384` | 单个 `AGENTS.md` 或 `CLAUDE.md` 的读取字节上限，最高 65,536。 |
| `maxResultBytes` | `65536` | Reviewer 结果大小上限，最高 262,144 字节。 |
| `evidenceReminder` | `true` | review 结果交接后，向父级轮次追加证据提示。 |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-command-code-review)列出所有可用字段和范围。Profile 配置由用户控制；仓库内的 `AGENTS.md`、`CLAUDE.md` 和 `.agents/skills/code-review/SKILL.md` 可提供项目专用 review 指引。现有 DSH Skill 查找机制也会向 reviewer 提供用户 Skills。

### Review 行为

命令读取父 Session 工作目录和 sandbox 工作区根目录共同授权的当前仓库，并记录当前分支和 `HEAD`、分别呈现暂存和未暂存 Git diff，以及未忽略未跟踪文件中的文本。它会读取仓库根目录及改动文件所在目录中的适用 `AGENTS.md` 和 `CLAUDE.md`。忽略路径、名称像敏感文件的路径、Git 元数据、二进制文件以及非普通未跟踪文件都会被省略。

Reviewer 是新的进程内 DSH 子 Session。其可信工具过滤器只允许 `skill`；文件系统、shell、subprocess、委派和策略修改工具都不可用。命令自己的 Git 子进程只执行固定只读命令列表、会禁用 Git hook 和全局配置，并使用以所选仓库为根目录的 DSH 只读 sandbox 策略。

源代码数据包是对实时状态的观察，不是不可变快照。命令会在读取前后以及 review 完成后比较有界的仓库证据，并拒绝捕获期间已变化的数据包。若 review 结束后捕获的证据发生变化，交给父级的结果会将问题发现标记为可能过时。证据提示只是建议，不会授予工具或执行权限策略。

### 上游来源标注

先报告问题的 review 流程借鉴 Everything Claude Code 的 reviewer 与命令流程，以及 Superpowers 的代码 review 和验证 Skills。DSH 随附 Skill 使用独立编写的文字，没有复制上游源代码或文本。两个上游仓库都声明使用 MIT 许可证；具体来源见[进一步探索](#further-exploration)。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[`src/index.ts`](src/index.ts) 捕获并限制仓库证据、启动受限子 Session、记录其运行标识，并将问题发现返回给父级。Web bundle 提供 `code-reviewer` preset 和随包 Skill；项目与用户 Skills 由现有 DSH Skill filesystem 发现。

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `/review`、有界 Git 和文件系统读取、生命周期处理与证据交接。 |
| [`src/git-command.ts`](src/git-command.ts) | 只读 Git 命令白名单与平台 null device 选择。 |
| [`src/repository-path.ts`](src/repository-path.ts) | 按主机路径规则比较规范化仓库路径。 |
| [`src/render.ts`](src/render.ts) | 敏感名称过滤、捕获证据摘要，以及 reviewer 和父级消息。 |
| [`../preset/agent-preset/skills/code-review/SKILL.md`](../../preset/agent-preset/skills/code-review/SKILL.md) | 随包提供的先报告问题 reviewer 指引。 |
| [`../../bundle/web-app/presets/code-reviewer.patch.yml`](../../bundle/web-app/presets/code-reviewer.patch.yml) | 只读 reviewer preset 与 Skill loader 组合。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Web app bundle](../../bundle/web-app/README.zh.md) — 支持的用户界面组合。
- [Commands package](../commands/README.zh.md) — 斜杠命令注册和分派。
- [Agent preset package](../../preset/agent-preset/README.zh.md) — 子 agent 组合和随包 Skills。
- [Skill filesystem](../../skill/skill-filesystem/README.zh.md) — 项目与用户 Skill 发现。
- [Everything Claude Code reviewer](https://github.com/affaan-m/ECC/blob/main/agents/code-reviewer.md)、[review 命令](https://github.com/affaan-m/ECC/blob/main/commands/code-review.md)、[hooks](https://github.com/affaan-m/ECC/blob/main/hooks/README.md)和[MIT 许可证](https://github.com/affaan-m/ECC/blob/main/LICENSE)。
- [Superpowers review Skill](https://github.com/obra/superpowers/blob/main/skills/requesting-code-review/SKILL.md)、[reviewer 提示词](https://github.com/obra/superpowers/blob/main/skills/requesting-code-review/code-reviewer.md)、[验证 Skill](https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md)和[MIT 许可证](https://github.com/obra/superpowers/blob/main/LICENSE)。

-----

<a id="model-experience"></a>
## 模型体验

### Reviewer 请求

#### 模型可见内容

子 agent 会收到捕获的仓库数据包和以下指令，然后通过唯一可用工具加载 `code-review` Skill。

##### Reviewer 指令

```markdown
Load the `code-review` Skill before reviewing this captured repository packet.
Review only the supplied content. You have no repository tools except the Skill loader.
Do not modify files, request more tools, or delegate. Report findings with severity, repository-relative path and line, confidence, and the supplied evidence. If no actionable issue is supported, say that no findings are supported.
```

#### Token 效果

每次 review 都会启动一次独立的子模型请求，其中包含最多 `maxPacketBytes` 的仓库证据、reviewer 指令和已加载 Skill。Skill loader 会把返回的 Skill 文本加入子 agent 上下文。

#### KV Cache 效果

子 agent 使用新的 Session，因此拥有独立模型上下文。数据包和仓库指令随每次调用变化，不会复用父级已有的请求前缀。

### 父级交接

#### 模型可见内容

成功完成后，命令会向父级添加仓库路径、分支、已提交 `HEAD`、捕获时间、源文件变化状态、reviewer Session 和运行标识、停止原因以及 reviewer 结果。`agent/pre-step` hook 可能会追加证据提示。

#### Token 效果

交接会在父级下一次模型请求中添加单独的 user 消息，其中包含不超过 `maxResultBytes` 的 reviewer 结果和已配置的证据提示。

#### KV Cache 效果

交接会更改本次 review 对应的父级请求后缀，不会替换之前的父级消息历史。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **源代码上下文有限** — reviewer 看到的是 diff 和改动的未跟踪文本，而不是全部未变更文件或仓库级测试结果，因此不能声称完成了全仓 review。
- **实时工作树** — 并发编辑可能使问题发现过时；比较机制会检测观察到的源文件变化，但不会创建不可变读取快照，也无法检测随后完全还原的短暂变化。
- **敏感文件过滤** — 忽略路径和名称像敏感文件的路径会被省略，但文件名过滤不等于密钥扫描，普通改动源码本身仍可能包含敏感文本。
- **Host 支持** — 随包的 `/review` 命令挂载在 DSH Web profile 中，并使用进程内 `spawn` provider。本包没有验证原生 Codex、Claude Code 委派或非 Web profile 行为。
- **文件系统标识** — 仓库包含性依据 DSH 文件系统路径标识判断，无法识别仓库内硬链接的数据实际来自仓库外部的情况。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

该 hook 仅在匹配到交接内容后添加模型指引。权限强制执行由子工具过滤器和只读执行服务负责。

</details>
