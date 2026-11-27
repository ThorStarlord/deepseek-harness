---
description: "选择并检查已获授权的 DSH Session、共享带来源归属的快照，并有意向关联 Session 分派有界工作。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-activity-coordination

[English](README.md) | 中文

## 概述

在 root Session 中打开 `/coordinate`，选择已关联 Activity 的 Workspace 和 Session，检查经过身份验证的有限快照，并有意将选定且带来源归属的证据加入协调对话。同一面板还可保存有界建议、要求经过身份验证的确认后再发送给目标 Session，并在之后恢复只追加的责任事实。确认不会增加目标权限，而目标接纳提示也不能证明任务已经完成。

## 目录

- [使用此包](#use-this-package)
- [了解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制和延期工作](#known-limitations-and-deferred-work)
- [开发者说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

将此 Web Client 包与其声明的依赖项及 Host `home-activity` 服务一同挂载。在 root Session 中，`/coordinate` 会打开只读发现面板；已完成的助手消息也会提供**提出责任建议**操作。

用户选择 Activity 及其关联的 Workspace/Session 组合，预览有限的近期证据，并明确决定是否将其加入协调对话。建议会与其确切的助手消息一同保存。确认视图会显示 Activity 与目标的身份、任务、纳入和排除范围、前置条件、已知冲突以及预期结果。弹窗会提示用户查看完整责任内容；发送操作位于所有提案详情之后。只有选择**确认并发送到此 Session**后，才会通过经过身份验证的 Host 路由提示所选目标。

在后续协调 Session 中重新考虑任务时，展开已保存的责任历史并选择“将此责任添加到当前对话”。DSH 会将完整的只追加记录作为用户消息排队；记录超过消息限制时会拒绝添加，提交状态不确定时必须先检查当前对话。

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节——单击展开</summary>

Client 根据已保存的 Activity 引用和当前 Workspace 成员关系推导候选组合。经过身份验证的 Remote 会在读取前重新检查访问权限和身份；发现过程不会激活目标 Session。只有用户检查并明确添加预览后，其证据才会作为普通的排队用户消息进入协调 Session；该消息会记录确切的 Activity、来源 Session、游标、观察时间、运行时事实和包含的文本，并将其标明为不可信的历史证据。

责任事实保存在带版本的只追加 StorageDomain 中。建议会记录协调 Session、助手事件、目标 Workspace 和 Session、有界任务、排除项、前置条件及预期结果。经过身份验证的确认绑定到已保存的建议；Host 通过 Session Gateway 发送提示，并保留目标自身的运行时与权限。之后的协调操作只读取目标历史，不会重试、恢复运行或改写发送记录。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [Home Activity 子系统](../../../docs/subsystems/home-activity.zh.md)——Activity 身份、关联和责任记录。
- [Home Activity 包](../../home/activity/README.zh.md)——Host 持久化和协调 Remote。
- [API Remotes](../../api/remotes/README.zh.md)——经过身份验证的 Client 到 Host 操作。
- [Web 应用 bundle](../../bundle/web-app/README.zh.md)——加载此包的 Web 组合。

-----

<a id="model-experience"></a>
## 模型体验

### 用户选定的 Activity Session 证据

#### 模型可见内容

用户检查并明确添加预览后，协调 Session 会收到一条普通排队用户消息；该消息根据 `ActivityCoordinationSessionSnapshot` 记录生成，包含 Activity 身份和目标、每个已选 Workspace 与 Session 的身份、观察来源与时间、事件游标、运行时事实以及有限的近期消息。消息会将目标文本标记为不可信的历史证据，而非指令或授权。

#### Token 效果

只会提交用户选定的快照，并限制消息数量和上下文总大小；选择和预览不会添加模型输入。

#### KV Cache 影响

选定证据作为新的 Session 消息发送，并遵循提供方的常规缓存行为；不会改写先前的 Session 历史。

### 已确认的责任提示

#### 模型可见内容

用户确认确切的已保存责任后，目标 Session 会通过普通用户提示收到 Activity 目标、任务、范围、排除项、前置条件、已知冲突和预期结果。该提示要求目标保留自身现有运行时权限并报告不确定性；它不会授予额外授权。

#### Token 效果

有界建议作为一条普通目标 Session 提示提交，并由目标 Session 的常规请求路径计入 token。

#### KV Cache 影响

该提示遵循目标提供方的常规缓存行为；此包不会改写目标历史。

### 明确选择后重新考虑已保存责任

#### 模型可见内容

用户选择已保存的责任历史后，当前协调 Session 会收到完整的只追加事实、稳定身份、作者和来源归属以及记录时间。消息会标明所有历史字段都是不可信的证据，而非指令、当前状态或授权。

#### Token 效果

完整记录符合消息限制时会作为一条排队用户消息添加。DSH 不会截断历史事实；超限记录会被拒绝。

#### KV Cache 影响

该用户消息使用协调模型的常规缓存行为；目标 Session 历史和责任事实不会被修改。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制和延期工作

当前包只协调用户选定的 DSH 原生 root Session；它不提供通用的多提供方 Session 抽象。

- Session 快照描述游标处记录的历史和观察到的运行时状态；它无法证明语义理解，也无法代表当前仓库内容。
- 协调是对一个目标 Session 的明确读取。此处没有后台监督、自动重试或自动继续。
- 目标接纳只确认其接收了提示。执行、独立验证和用户接受仍是不同事实。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——单击展开</summary>

无。

</details>
