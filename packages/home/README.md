---
description: "Package map for persistent user-directed Home Activities, their saved intent, and the Activity identity service."
kind: "package-group"
---

# packages/home

English | [中文](README.zh.md)

## Summary

The `home/` group owns persistent user-directed Activity identity and saved intent. An Activity has a name, objective, descriptive in-scope and out-of-scope statements, and a stable id. It does not represent a Session, Goal, Workflow, Workspace project, or authorization grant. The current user entry point is the Web `/activity` command.

## Packages

| Package | Role | ctx key |
|---|---|---|
| [`activity/`](activity/README.md) | Persists Activity identity, objective, and descriptive boundaries without starting work | `ctx.homeActivities` |

## Related documentation

- [Home Activity subsystem](../../docs/subsystems/home-activity.md) — domain vocabulary, persistence version, and Cordis API.
