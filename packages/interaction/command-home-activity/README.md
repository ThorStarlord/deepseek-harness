---
description: "Create, list, and reopen saved Home Activities through the Web command composer without starting their objectives."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-home-activity

English | [中文](README.zh.md)

## Summary

Use `/activity` in the Web composer to create, list, and open saved Activities, or explicitly delegate one task to the DSH-native `spawn` provider. Delegation starts a separate one-shot child Session and records its provider-reported result. The Activity objective is not executed automatically. The command requires `ctx.commands`, `ctx.homeActivities`, `ctx.homeActivityDelegations`, and `ctx.subagents` services.

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

The Web profile mounts the command with the command registry and durable Activity service.

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
| `/activity open <activity-id>` | Show the saved objective, descriptive boundaries, and delegation records. |
| `/activity delegate <activity-id> spawn <task>` | Save the request, explicitly start one DSH-native child activation, and report the provider outcome separately. The task is limited to 4,096 UTF-8 bytes. |

Create JSON is limited to 16,384 UTF-8 bytes. A delegation request is durably saved before provider startup; the command returns after DSH accepts the activation, while outcome recording continues independently. A rejected startup is recorded as not admitted. If admission or outcome persistence is uncertain, inspect the Activity and child Session before retrying. Provider output is reported as supplied and is never labeled verified or accepted.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The command is registered for explicit human invocation, not as a model tool. Save/list/open use `ctx.homeActivities`; delegation uses the existing `ctx.subagents.startActivation` lifecycle and a separate persisted record. It does not create a Goal or claim that a provider report was verified or accepted.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Command registration and dispatch |
| [`src/delegation-command.ts`](src/delegation-command.ts) | Delegation parsing, lifecycle, and user-facing results |
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

None, as the human command reads and writes Activity records without a model request.

#### KV Cache effect

None; delegated work uses a separate child Session rather than modifying the parent context.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

Activity scope statements describe the requested work; they do not restrict child tools or permissions. DSH active runtime policy controls access.

- The Web composer is the only interaction surface; there is no standalone Activity browser or native Desktop command.
- Create input is JSON text, and Activities cannot be edited or deleted through this command. Only the `spawn` DSH-native provider is supported for delegation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
