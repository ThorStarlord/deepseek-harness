---
description: "Create, list, reopen, and associate saved Home Activities with Workspace or DSH Session references through the Web command composer without starting their objectives."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-home-activity

English | [中文](README.zh.md)

## Summary

Use `/activity` in the Web composer to create a named Activity with its objective and descriptive boundaries, list saved Activities, reopen saved details, and link selected Workspace or DSH Session identities. The command runs without a model round trip and does not start the saved objective. It requires the command registry, Activity and association services, Workspace registry, and Session persistence.

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

The Web profile mounts the command with the command registry, durable Activity and association services, Workspace registry, and Session persistence.

### When to choose it

Use `/activity` when a user needs to save intent for later conversations. Use `/goal` for a completion objective attached to the current Session; an Activity does not start or activate a Goal.

### Minimal configuration

This package has no configuration fields. In a composition that already provides both injected services, add this plugin:

```yaml
- name: '@deepseek-ai/dsh-command-home-activity'
```

The [command registry](../commands/README.md) owns direct human-command invocation, and [`dsh-home-activity`](../../home/activity/README.md) owns durable records.

### Command reference

| Command | Behavior |
|---|---|
| `/activity create <JSON>` | Save a name, objective, and `boundaries` object with `inScope` and `outOfScope` string arrays. At least one `inScope` item is required. |
| `/activity list` | List saved Activities newest first, with their names and stable ids. |
| `/activity open <activity-id>` | Show the saved objective, descriptive boundaries, and current Workspace and Session references. Missing references remain visible as unavailable. |
| `/activity workspaces` | List registered Workspace identities and their directory status. These identify DSH Workspaces; no Git root is inferred. |
| `/activity sessions` | List stored DSH Session identities and header details. Sessions are selected separately from Workspaces. |
| `/activity link <activity-id> workspace <workspace-id>` | Link one existing Workspace registry identity. Repeating the same link is idempotent. |
| `/activity link <activity-id> session <session-id>` | Link one existing stored DSH Session identity. Repeating the same link is idempotent. |
| `/activity unlink <activity-id> workspace <workspace-id>` | Remove the reference, including an unavailable Workspace id, without changing the Workspace record. |
| `/activity unlink <activity-id> session <session-id>` | Remove the reference, including an unavailable Session id, without changing the Session log. |

Workspace and Session links are separately user-authored; sharing an Activity does not assign a Session to a Workspace or assert repository origin. Correct a reference by unlinking it and linking the replacement. Command input is limited to 16,384 UTF-8 bytes. An uncertain storage result asks the user to reopen the Activity before retrying.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The command is registered as a human command, not a model tool. It persists Activity records through `ctx.homeActivities` and references through `ctx.homeActivityAssociations`. Linking does not change Workspace records, Session logs, Goal state, permissions, or execution.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Command registration, input validation, and user-facing results |
| [`src/association-command.ts`](src/association-command.ts) | Context discovery and explicit link/unlink commands |
| [`tests/command.spec.ts`](tests/command.spec.ts) | Command behavior, safe failures, and no-execution assertions |

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

None, as the command is user-invoked and adds no model-visible input or request.

#### KV Cache effect

None; the command does not create a model request or change model context.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

The command saves and displays intent only.

- The Web composer is the only interaction surface; there is no standalone Activity browser or native Desktop command.
- Create input is JSON text, and Activities cannot be edited or deleted through this command.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
