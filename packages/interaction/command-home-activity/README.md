---
description: "Create, list, reopen, associate, and explicitly delegate saved Home Activities through the Web composer or SDK session.run()."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-home-activity

English | [中文](README.zh.md)

## Summary

Use /activity in the Web composer or SDK session.run() to create, list, and reopen named Activities, manage selected context links and artifact pointers, explicitly delegate bounded tasks through the DSH-native spawn or optional one-shot Codex provider, and separately record a user's disposition and attributed verification evidence. Activity commands do not start saved objectives automatically; review never starts or retries delegation, and provider reports remain unchanged. Codex uses its native configuration and permission mode, and Activity does not expose continuation, resume, transcript inspection, or rollback. The command requires the command registry and the Home Activity services used by mounted commands.

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

A composition that enables delegation also mounts `@deepseek-ai/dsh-home-activity/delegations`, `@deepseek-ai/dsh-subagent`, and a supported provider. The command supports `spawn` and supports `codex` when the optional native Codex provider is enabled.

### Command reference

| Command | Behavior |
|---|---|
| `/activity create <JSON>` | Save a name, objective, and `boundaries` object with `inScope` and `outOfScope` string arrays. At least one `inScope` item is required. |
| `/activity list` | List saved Activities newest first, with their names and stable ids. |
| `/activity workspaces` | List registered Workspace contexts that can be linked. |
| `/activity sessions` | List stored DSH Sessions and their available summary metadata. |
| `/activity link <activity-id> workspace <workspace-id>` | Record a selected Workspace reference without changing the Workspace record. |
| `/activity link <activity-id> session <session-id>` | Record a selected DSH Session reference without changing its Session log. |
| `/activity unlink <activity-id> workspace <workspace-id>` | Remove a Workspace reference while preserving its source record. |
| `/activity unlink <activity-id> session <session-id>` | Remove a DSH Session reference while preserving its log. |
| `/activity artifact add <activity-id> <delegation-id> <workspace-id> <JSON>` | Record a user-linked output pointer with a Workspace already linked to the same Activity and a delegation owned by that Activity. JSON fields are `label`, `location`, and optional `revision`; an absent revision is displayed as unknown. |
| `/activity delegate <activity-id> spawn <task>` | Save the request, explicitly start one DSH-native child activation, and report the provider outcome separately. The task is limited to 4,096 UTF-8 bytes. |
| `/activity delegate <activity-id> codex <task>` | Save the request, explicitly start one native Codex execution, and report its outcome separately. It is one-shot and does not create a DSH Session. The task is limited to 4,096 UTF-8 bytes. |
| `/activity review set <activity-id> <delegation-id> <JSON>` | Record an explicit user disposition and optional user-supplied evidence for a saved provider report without changing the report; the command rejects reviews until that report is saved. JSON requires `disposition` (`pending`, `accepted`, `declined`, or `requires-investigation`); optional `evidence` contains `source`, `result` (`passed`, `failed`, `inconclusive`, or `unavailable`), and `summary`, with optional `reference` and `observedAt`. Its response distinguishes new evidence, retained evidence, and no evidence recorded. |

Create, artifact, and review JSON are limited to 16,384 UTF-8 bytes. Each Activity can reference at most 256 Workspaces, 256 DSH Sessions, and 512 artifact pointers. Review evidence is append-only within the current review record and capped at 128 entries per delegation. Evidence names its user-entered source and reported result; DSH does not check it. A provider success remains a provider report and never implies verification or user acceptance. A review requires a saved provider report. A delegation request is saved before provider startup; a proposed `spawn` child Session id is not proof of admission, and Codex does not invent a DSH Session id. The command returns after DSH accepts activation while outcome recording continues independently. A rejected startup is recorded as not admitted. If a Codex start call rejects after provider invocation begins, its outcome is unconfirmed because the external run may already have started; do not repeat the task unless you independently confirm it did not start. Opening an Activity never retries it. If `spawn` admission is uncertain, `/activity sessions` shows whether a Session with the proposed id is stored and its available summary metadata; it does not inspect the transcript. An absent Session does not confirm startup failure. A Codex admission records the provider adapter's `SubagentRun.id`, displayed as a Codex adapter run id, not a DSH Session or native Codex thread id. Artifact pointers remain separate from reports and mark their relation to output as unverified.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>


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

Indirectly, through the explicit `/activity delegate` command, which starts one execution through the selected provider and records the request, DSH admission, and provider report separately without implying verification or user acceptance.

#### KV Cache effect

None; delegated work runs separately from the parent context. Only `spawn` creates a DSH child Session.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

Activity scope statements describe requested work; they do not change provider permissions. DSH runtime policy controls `spawn`; native Codex configuration and its configured permission mode control `codex`.

- The Web composer and SDK session.run() are the supported interaction surfaces; there is no standalone Activity browser or native Desktop command. SDK support requires a profile that mounts the Home Activity plugins.
- Create input is JSON text, and Activities cannot be edited or deleted through this command. `spawn` and Codex delegation are explicit one-shot operations; Activity does not expose continuation, resume, transcript inspection, or rollback. The Session catalog shows summary metadata only; it does not inspect child conversations or prove provider admission.
- Review evidence and its reported result are user supplied and not checked by DSH. The current disposition remains pending until the user changes it; reporting execution success does not accept the outcome.
- Artifact locations, revisions, and Workspace selection are user supplied. The command does not inspect referenced files or infer a Git root from a Workspace directory; missing revisions remain unknown, and pointers do not verify execution context or provider output.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
