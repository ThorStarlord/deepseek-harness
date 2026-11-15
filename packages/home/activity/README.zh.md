---
description: "独立于 agent Session 保存、列出并重新打开命名的用户 Activity。"
kind: "package-reference"
---

# @deepseek-ai/dsh-home-activity

[English](README.md) | 中文

## 概述

保存命名 Activity、目标和描述性边界，使其在原 Session 结束后仍可使用。通过 Web `/activity` 命令列出并重新打开同一 Activity。创建或打开 Activity 不会执行目标、创建 Goal、关联 Session，也不会授予运行时权限。

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

Web 配置会将此服务与 JSON StorageDomain 提供方及人工调用的 `/activity` 命令一同加载。

### 何时选择

当用户发起的事务需要独立于 Session 的稳定身份和已保存意图时，选择 Activity。交互历史使用 Session，同一 Session 内的完成跟踪使用 Goal，目录分组使用 Workspace project。

### 最小配置

此服务没有配置字段。自定义组合需先提供现有存储栈，再挂载此服务：

```yaml
- name: '@deepseek-ai/dsh-storage'
- name: '@deepseek-ai/dsh-storage-json'
  config:
    root: /var/lib/dsh/storages
- name: '@deepseek-ai/dsh-storage-domain'
  config:
    backend: json
- name: '@deepseek-ai/dsh-home-activity'
```

存储提供方拥有各自的设置；请参阅 [JSON 后端](../../storage/storage-json/README.zh.md)和 [StorageDomain](../../storage/storage-domain/README.zh.md)参考。

-----

<a id="understand-the-implementation"></a>
## 了解实现

<details>
<summary>实现细节 — 点击展开</summary>

Activity 记录使用版本 1 的 `home_activities` StorageDomain，并独立于 Session、Goal 和 Workspace 记录。此服务提供持久创建与同步读取，没有执行或激活路径。

| 文件 | 职责 |
|---|---|
| [`src/types.ts`](src/types.ts) | Activity 身份与请求类型 |
| [`src/spec.ts`](src/spec.ts) | 带版本的持久化记录 schema |
| [`src/index.ts`](src/index.ts) | StorageDomain 服务 |
| [`tests/activity.spec.ts`](tests/activity.spec.ts) | 存储关闭、重开与校验行为 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Home Activity 子系统](../../../docs/subsystems/home-activity.zh.md) — 领域与持久化语义。
- [StorageDomain](../../storage/storage-domain/README.zh.md) — 带版本的主机端记录。
- [Web `/activity` 命令](../../interaction/command-home-activity/README.zh.md) — 创建、列出并打开 Activity。

-----

<a id="model-experience"></a>
## 模型体验

此服务会保存 Activity 记录，不会增加模型上下文或工具。

#### KV 缓存影响

无；Activity 的读取和写入不会改变模型请求。

## 已知限制与后续工作
<a id="known-limitations-and-deferred-work"></a>

当前记录保存用户意图，但不协调执行。

- 边界是描述性陈述，不是沙箱根目录或权限授予。
- Activity 尚未关联仓库、Session、委派工作、可复用知识或执行证据。
- 此服务没有编辑、删除、调度或执行操作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
