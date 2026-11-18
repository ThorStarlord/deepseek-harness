---
description: "Create, list, reopen, associate, and explicitly delegate saved Home Activities through the Web composer or SDK session.run()."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-home-activity

English | [中文](README.zh.md)

## Summary

Use /activity in the Web composer or SDK session.run() to create a named Activity with its objective and descriptive boundaries, list and reopen Activities, manage context links and artifact pointers, explicitly delegate bounded work, and separately record a user's disposition and attributed verification evidence. Activity commands do not start saved objectives automatically; review never starts or retries delegation, and provider reports remain unchanged. The command requires the command registry and the Home Activity services used by the mounted commands.

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

The Web and SDK profiles mount the command with the command registry, durable Activity and association services, Workspace registry, and Session persistence. Delegation also requires the Activity delegation and subagent services plus a supported DSH-native provider.

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
| `/activity open <activity-id>` | Show saved intent, context references, delegation reports, artifact pointers, and separate user-review state for each delegation. A missing review is shown as pending. |
| `/activity workspaces` | List registered Workspace contexts that can be linked. |
| `/activity sessions` | List stored DSH Sessions and their available summary metadata. |
| `/activity link <activity-id> workspace <workspace-id>` | Record a selected Workspace reference without changing the Workspace record. |
| `/activity link <activity-id> session <session-id>` | Record a selected DSH Session reference without changing its Session log. |
| `/activity unlink <activity-id> workspace <workspace-id>` | Remove a Workspace reference while preserving its source record. |
| `/activity unlink <activity-id> session <session-id>` | Remove a DSH Session reference while preserving its log. |
| `/activity artifact add <activity-id> <delegation-id> <workspace-id> <JSON>` | Record a user-linked output pointer with a Workspace already linked to the same Activity and a delegation owned by that Activity. JSON fields are `label`, `location`, and optional `revision`; an absent revision is displayed as unknown. |
| `/activity delegate <activity-id> spawn <task>` | Save the request, explicitly start one DSH-native child activation, and report the provider outcome separately. The task is limited to 4,096 UTF-8 bytes. |
| `/activity review set <activity-id> <delegation-id> <JSON>` | Record an explicit user disposition and optional user-supplied evidence without changing the provider report. JSON requires `disposition` (`pending`, `accepted`, `declined`, or `requires-investigation`); optional `evidence` contains `source`, `result` (`passed`, `failed`, `inconclusive`, or `unavailable`), and `summary`, with optional `reference` and `observedAt`. Its response distinguishes new evidence, retained evidence, and no evidence recorded. |

Command JSON is limited to 16,384 UTF-8 bytes. Each Activity can reference at most 256 Workspaces, 256 DSH Sessions, and 512 artifact pointers. Review evidence is append-only within the current review record and capped at 128 entries per delegation. Evidence names its user-entered source and reported result; DSH does not check it. A provider success remains a provider report and never implies verification or user acceptance. A delegation request and proposed child Session id are saved before provider startup; the id is not proof of admission. The command returns after DSH accepts activation while outcome recording continues independently. A rejected startup is recorded as not admitted. If admission is uncertain, `/activity sessions` shows whether a Session with the proposed id is stored and its available summary metadata; it does not inspect the transcript. An absent Session does not confirm startup failure. Artifact pointers remain separate from reports and mark their relation to output as unverified.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The command is registered for explicit human invocation, not as a model tool. Save/list/open use `ctx.homeActivities`; context references use `ctx.homeActivityAssociations`; artifact pointers use `ctx.homeActivityArtifacts`; reviews use `ctx.homeActivityReviews`; delegation uses the existing `ctx.subagents.startActivation` lifecycle and separate persisted facts. Review commands do not call the delegation service or alter provider-authored records.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Command registration and dispatch |
| [`src/delegation-command.ts`](src/delegation-command.ts) | Delegation parsing, lifecycle, and user-facing results |
| [`src/association-command.ts`](src/association-command.ts) | Workspace and Session catalogs, reference commands, and resolution |
| [`src/artifact-command.ts`](src/artifact-command.ts) | User-linked artifact pointer commands and rendering |
| [`src/review-command.ts`](src/review-command.ts) | Review input, persistence command, and outcome rendering |
| [`tests/command.spec.ts`](tests/command.spec.ts) | Command behavior, safe failures, and no-execution assertions |
| [`apps/web/tests/home-activity-review.e2e.ts`](../../../apps/web/tests/home-activity-review.e2e.ts) | Review disposition and evidence through the assembled Web app and command RPC |
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

- The Web composer and SDK session.run() are the supported interaction surfaces; there is no standalone Activity browser or native Desktop command. SDK support requires a profile that mounts the Home Activity plugins.
- Create input is JSON text, and Activities cannot be edited or deleted through this command. Only the spawn DSH-native provider is supported for delegation. The Session catalog shows summary metadata only; it does not inspect child conversations or prove provider admission.
- Review evidence and its reported result are user supplied and not checked by DSH. The current disposition remains pending until the user changes it; reporting execution success does not accept an outcome.
- Artifact locations, revisions, and Workspace selection are user supplied. The command does not inspect referenced files or infer a Git root from a Workspace directory; missing revisions remain unknown, and pointers do not verify execution context or provider output.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
