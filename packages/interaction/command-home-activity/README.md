---
description: "Create, list, reopen, associate, and explicitly delegate saved Home Activities through the Web command composer."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-home-activity

English | [中文](README.zh.md)

## Summary

Use `/activity` in the Web composer to create, list, and open saved Activities, link selected Workspace and DSH Session identities, or explicitly delegate one task to the DSH-native `spawn` provider. Delegation starts a separate one-shot child Session and records its provider-reported result. Associations do not assign Sessions to Workspaces; the Activity objective is not executed automatically. The command requires the command registry, Activity, association, delegation, Workspace, Session persistence, and subagent services.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The Web profile mounts the command with the command registry, Activity and association services, Workspace registry, and Session persistence.

### When to choose it

Use `/activity` when a user needs to save intent for later conversations. Use `/goal` for a completion objective attached to the current Session; an Activity does not start or activate a Goal.

### Minimal configuration

This package has no configuration fields. In a composition that already provides both injected services, add this plugin:

```yaml
- name: '@deepseek-ai/dsh-command-home-activity'
```

The [command registry](../commands/README.md) owns direct human-command invocation, and [`dsh-home-activity`](../../home/activity/README.md) owns durable records.

A composition that enables delegation also mounts `@deepseek-ai/dsh-home-activity/delegations`, `@deepseek-ai/dsh-subagent`, and a supported DSH-native provider. The current command supports `spawn`.

### Command reference

| Command | Behavior |
|---|---|
| `/activity create <JSON>` | Save a name, objective, and `boundaries` object with `inScope` and `outOfScope` string arrays. At least one `inScope` item is required. |
| `/activity list` | List saved Activities newest first, with their names and stable ids. |
| `/activity open <activity-id>` | Show the saved objective, descriptive boundaries, context references, and delegation records. |
| `/activity workspaces` | List registered Workspace contexts that can be linked. |
| `/activity sessions` | List stored DSH Sessions and their available summary metadata. |
| `/activity link <activity-id> workspace <workspace-id>` | Record a selected Workspace reference without changing the Workspace record. |
| `/activity link <activity-id> session <session-id>` | Record a selected DSH Session reference without changing its Session log. |
| `/activity unlink <activity-id> workspace <workspace-id>` | Remove a Workspace reference while preserving its source record. |
| `/activity unlink <activity-id> session <session-id>` | Remove a DSH Session reference while preserving its log. |
| `/activity delegate <activity-id> spawn <task>` | Save the request, explicitly start one DSH-native child activation, and report the provider outcome separately. The task is limited to 4,096 UTF-8 bytes. |

Create JSON is limited to 16,384 UTF-8 bytes. Each Activity can reference at most 256 Workspaces and 256 DSH Sessions. A delegation request and proposed child Session id are durably saved before provider startup; the id is not proof of admission. The command returns after DSH accepts the activation, while outcome recording continues independently. A rejected startup is recorded as not admitted. If admission is uncertain, `/activity sessions` shows whether a stored Session with the proposed id is visible and any available summary metadata; it does not inspect that Session's transcript. An absent Session does not confirm startup failure. Provider output is reported as supplied and is never labeled verified or accepted.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The command is registered for explicit human invocation, not as a model tool. Save/list/open use `ctx.homeActivities`; context references use `ctx.homeActivityAssociations`; delegation uses the existing `ctx.subagents.startActivation` lifecycle and a separate persisted record. It does not create a Goal or claim that a provider report was verified or accepted.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Command registration and dispatch |
| [`src/delegation-command.ts`](src/delegation-command.ts) | Delegation parsing, lifecycle, and user-facing results |
| [`src/association-command.ts`](src/association-command.ts) | Workspace and Session catalogs, reference commands, and resolution |
| [`tests/command.spec.ts`](tests/command.spec.ts) | Command behavior, safe failures, and no-execution assertions |
| [`tests/delegation.e2e.spec.ts`](tests/delegation.e2e.spec.ts) | Provider-backed command success and failure through the host seam |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Home Activity service](../../home/activity/README.md) — durable identity and saved intent.
- [Human command registry](../commands/README.md) — command registration and invocation.
- [Home Activity subsystem](../../../docs/subsystems/home-activity.md) — domain and persistence semantics.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the explicit `/activity delegate` command, which starts one DSH-native child activation with the selected provider and records the request, DSH admission, and provider report separately without implying verification or user acceptance.

#### KV Cache effect

None; delegated work uses a separate child Session rather than modifying the parent context.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

Activity scope statements describe the requested work; they do not restrict child tools or permissions. DSH active runtime policy controls access.

- The Web composer is the only interaction surface; there is no standalone Activity browser or native Desktop command.
- Create input is JSON text, and Activities cannot be edited or deleted through this command. Only the `spawn` DSH-native provider is supported for delegation. The Session catalog shows summary metadata only; it does not inspect child conversations or prove admission.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
