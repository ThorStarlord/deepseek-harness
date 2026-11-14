---
description: "Home Activity 持久化用户事务及其已保存意图、Activity 身份服务的包映射。"
kind: "package-group"
---

# packages/home

[English](README.md) | 中文

## 概述

`home/` 组负责持久保存用户发起的 Activity 身份与意图。Activity 包含名称、目标、描述性的范围内与范围外事项，以及稳定 id。它不代表 Session、Goal、Workflow、Workspace 项目或授权。本组当前通过 Web `/activity` 命令提供用户入口。

## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`activity/`](activity/README.zh.md) | 持久保存 Activity 身份、目标和描述性边界，不启动工作 | `ctx.homeActivities` |

## 相关文档

- [Home Activity 子系统](../../docs/subsystems/home-activity.zh.md) — 领域词汇、持久化版本与 Cordis API。
