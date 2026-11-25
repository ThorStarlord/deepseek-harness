---
description: "Create, list, reopen, associate, and explicitly delegate or continue saved Home Activities through the Web composer or SDK session.run()."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-home-activity

English | [中文](README.zh.md)

## Summary

Use `/activity` in Web or SDK `session.run()` to manage saved Activities and explicitly request source-grounded strategic briefs or bounded delegation. An assessment loads existing Sensemaking Skills and reads selected repositories only through the separate approval. Opening a saved brief does not rerun it. Delegation records provider reports separately from verification and user acceptance; Codex and Claude Code retain their native authentication and one-shot behavior.

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

The Web and SDK profiles mount the command with the command registry, tool registry, durable Activity, association, annotation, and strategic episode services, Workspace registry, and Session persistence. Strategic assessment also requires the active Agent's DSH Skill registry to provide `using-sensemaking` and `multi-repository-strategic-analysis`, plus the existing read-only multi-repository tool. If the coordinator is missing from the profile or excluded by the Agent's tool restrictions, assessment fails before loading Skills or installing its request guard; no repository read starts. See the [multi-repository coordinator](../../workspace/tool-multi-repository/README.md) for its approval and access model. Delegation also requires the Activity delegation and subagent services plus a supported DSH-native provider.

### When to choose it

Use `/activity` when a user needs to save intent for later conversations. Use `/goal` for a completion objective attached to the current Session; an Activity does not start or activate a Goal.

### Minimal configuration

This package has no configuration fields. In a composition that already provides both injected services, add this plugin:

```yaml
- name: '@deepseek-ai/dsh-command-home-activity'
```

The [command registry](../commands/README.md) owns direct human-command invocation, and [`dsh-home-activity`](../../home/activity/README.md) owns durable records. Mount `@deepseek-ai/dsh-home-activity/handoffs` to record user-supplied external work summaries and references.

A composition that enables delegation also mounts `@deepseek-ai/dsh-home-activity/delegations`, `@deepseek-ai/dsh-subagent`, and a supported provider. The command supports `spawn`, `codex` when the optional native Codex provider is enabled, and `claude-code` when the optional native Claude Code provider is enabled.

### Command reference

| Command | Behavior |
|---|---|
| `/activity create <JSON>` | Save a name, objective, and `boundaries` object with `inScope` and `outOfScope` string arrays. At least one `inScope` item is required. |
| `/activity list` | List saved Activities newest first, with their names and stable ids. |
| `/activity open <activity-id>` | Show the saved objective, descriptive boundaries (in-scope statements are numbered for the continuation command), the current user annotation and latest revisions, the latest strategic brief, context references, delegation records, the captured profile and preset selection, and read-only next actions supported by saved lifecycle facts and currently registered provider routes. Earlier brief revisions remain saved and can be inspected with `/activity brief <activity-id> <revision>`. Route registration does not establish credential readiness, user consent, native permission, or provider admission. |
| `/activity brief <activity-id> <revision>` | Inspect one saved strategic brief revision with its cited evidence and uncertainties. The view reports later saved observations without re-reading a repository. |
| `/activity assess <activity-id> <workspace-id> <workspace-id>` | Explicitly request an advisory strategic assessment of exactly two registered Workspaces. If the active Agent cannot use the read-only coordinator because the profile or its tool restrictions exclude it, DSH reports that before loading Skills or applying the request guard. Otherwise DSH loads the two Sensemaking Skills into the active Agent's logged task. Before reading, the existing coordinator asks for separate one-shot approval of the exact task and selected Workspaces; after approval it starts one read-only DSH child Session per Workspace, with no implementation or repository mutation tools. A request-scoped tool saves a structured brief with repository revisions, source references, alternatives, uncertainties, and recommendation or no-selection. |
| `/activity assess cancel` | Discard the unfinished brief request for the current Session. Before a model turn claims the queued assessment instruction, cancellation removes that instruction and releases the request guard. After a claim, cancellation prevents saving but does not stop repository reads already approved and running; other model tool calls remain blocked until that claiming turn ends and any approved coordinator call returns. A saved brief cannot be canceled. |
| `/activity annotate <activity-id> <JSON>` | Append a user-authored coordination note or correction without changing provider reports or specialist assertions. JSON requires `text`; `/activity open` shows the current note and retained revision history separately. |
| `/activity workspaces` | List registered Workspace contexts that can be linked. |
| `/activity sessions` | List stored DSH Sessions and their available summary metadata. |
| `/activity link <activity-id> workspace <workspace-id>` | Record a selected Workspace reference without changing the Workspace record. |
| `/activity link <activity-id> session <session-id>` | Record a selected DSH Session reference without changing its Session log. |
| `/activity unlink <activity-id> workspace <workspace-id>` | Remove a Workspace reference while preserving its source record. |
| `/activity unlink <activity-id> session <session-id>` | Remove a DSH Session reference while preserving its log. |
| `/activity artifact add <activity-id> <delegation-id> <workspace-id> <JSON>` | Record a user-linked output pointer with a Workspace already linked to the same Activity and a delegation owned by that Activity. JSON fields are `label`, `location`, and optional `revision`; an absent revision is displayed as unknown. |
| `/activity handoff add <activity-id> <JSON>` | Record a user-supplied external handoff for an existing Activity. JSON fields are `source`, optional `summary`, optional `sourceReference`, and optional `artifacts` containing `label`, `location`, and optional `revision`. Include at least one summary, source reference, or artifact. |
| `/activity delegate <activity-id> spawn <task>` | Save the request, explicitly start one DSH-native child activation, and report the provider outcome separately. The task is limited to 4,096 UTF-8 bytes. |
| `/activity delegate <activity-id> codex <task>` | Save the request, explicitly start one native Codex execution, and report its outcome separately. It is one-shot and does not create a DSH Session. The task is limited to 4,096 UTF-8 bytes. |
| `/activity delegate <activity-id> claude-code <task>` | Save the request, explicitly start one native Claude Code execution, and report its outcome separately. It is one-shot and does not create a DSH Session. The task is limited to 4,096 UTF-8 bytes. |
| `/activity continue <activity-id> spawn|codex|claude-code in-scope:<n> <bounded next step>` | Explicitly start a new delegation with the saved objective, the selected one-based in-scope statement, and the user's next step. This does not resume prior provider execution. Activity scope is descriptive; native provider permissions remain unchanged. |
| `/activity review set <activity-id> <delegation-id> <JSON>` | Record an explicit user disposition and optional user-supplied evidence for a saved provider report without changing the report; the command rejects reviews until that report is saved. JSON requires `disposition` (`pending`, `accepted`, `declined`, or `requires-investigation`); optional `evidence` contains `source`, `result` (`passed`, `failed`, `inconclusive`, or `unavailable`), and `summary`, with optional `reference` and `observedAt`. Its response distinguishes new evidence, retained evidence, and no evidence recorded. |

Annotation JSON is limited to 16,384 UTF-8 bytes, and note text to 4,000 characters. Note text must stay on one line and rejects control, format, line, and paragraph separators. Each Activity retains at most 256 user-command revisions; `/activity open` shows the current note and latest 8 while earlier revisions remain saved. A rejected annotation write does not confirm whether the revision was persisted or rolled back. Because JSON storage may report an error after file replacement, restart DSH and open the Activity to inspect saved history before deciding whether to retry.

Create, artifact, and review JSON are limited to 16,384 UTF-8 bytes. Each Activity can reference at most 256 Workspaces, 256 DSH Sessions, and 512 artifact pointers. Review evidence is append-only within the current review record and capped at 128 entries per delegation. Evidence names its user-entered source and reported result; DSH does not check it. A provider success remains a provider report and never implies verification or user acceptance. A review requires a saved provider report. A delegation request is saved before provider startup; a proposed `spawn` child Session id is not proof of admission, and external providers do not invent DSH Session ids. The command returns after DSH accepts activation while outcome recording continues independently. A rejected startup is recorded as not admitted. If a Codex or Claude Code start call rejects after provider invocation begins, its outcome is unconfirmed because the external run may already have started; do not repeat the task unless you independently confirm it did not start. Opening an Activity never retries it. If `spawn` admission is uncertain, `/activity sessions` shows whether a Session with the proposed id is stored and its available summary metadata; it does not inspect the transcript. An absent Session does not confirm startup failure. An external admission records the provider adapter's `SubagentRun.id`, not a DSH Session or native provider conversation id. Artifact pointers remain separate from reports and mark their relation to output as unverified.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The command is registered for explicit human invocation, not as a model tool. Save/list/open use `ctx.homeActivities`; context references use `ctx.homeActivityAssociations`; delegation uses the existing `ctx.subagents.startActivation` lifecycle and a separate persisted record; review uses `ctx.homeActivityReviews`. DSH `spawn` captures the launcher profile bundle selection and the exact active Agent preset modules before startup. Codex and Claude Code are recorded as unavailable because their external runtimes do not expose DSH profile or preset data. It does not create a Goal or claim that a provider report was verified or accepted. External handoffs use ctx.homeActivityHandoffs.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Command registration and dispatch |
| [`src/delegation-command.ts`](src/delegation-command.ts) | Delegation parsing, lifecycle, and user-facing results |
| [`src/next-actions.ts`](src/next-actions.ts) | Read-only recovery guidance from saved outcomes and registered provider routes |
| [`src/continuation-command.ts`](src/continuation-command.ts) | Explicit continuation parsing and delegation through the existing provider path |
| [`src/execution-selection.ts`](src/execution-selection.ts) | DSH profile and preset snapshot and conservative product classification |
| [`src/association-command.ts`](src/association-command.ts) | Workspace and Session catalogs, reference commands, and resolution |
| [`src/artifact-command.ts`](src/artifact-command.ts) | User-linked artifact pointer commands and rendering |
| [`src/review-command.ts`](src/review-command.ts) | Review input, persistence command, and outcome rendering |
| [`src/handoff-command.ts`](src/handoff-command.ts) | User-supplied external handoff command and rendering |
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

Indirectly, through explicit `/activity assess`, `/activity delegate`, and `/activity continue` commands. Assessment steers the current Agent and records an advisory source-grounded brief only for the matching explicit request; it uses the existing read-only repository coordinator after its separate approval. Delegation starts one provider execution and records the request, DSH admission, and provider report separately without implying verification or user acceptance. Continuation creates a new request from the saved objective, selected descriptive scope statement, and user's next step; it does not resume prior provider execution.

#### KV Cache effect

An explicit assessment adds the Activity objective, selected Workspace roots, and loaded Sensemaking Skill bodies to the active Session. After separate one-shot approval of the exact task and selected repositories, the existing coordinator starts one read-only DSH child Session per repository; those Sessions can inspect repository sources but cannot implement or mutate either repository. An assessment itself does not start implementation, grant write access, or change the active Agent's existing tools or permissions. Implementation delegation remains a separate Activity action with its own provider authorization.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

Activity scope statements describe requested work; they do not change provider permissions. DSH runtime policy controls `spawn`; native Codex configuration and its configured permission mode control `codex`; native Claude Code configuration and permission handling control `claude-code`.

- The Web composer and SDK session.run() are the supported interaction surfaces; there is no standalone Activity browser or native Desktop command. SDK support requires a profile that mounts the Home Activity plugins.
- Create input is JSON text, and Activities cannot be edited or deleted through this command. `/activity continue` records a new explicit request; selecting a descriptive scope statement does not semantically prove the next step fits it or restrict provider permissions. Codex and Claude Code executions remain one-shot and cannot be resumed, inspected, or rolled back through Activity. The Session catalog shows summary metadata only; it does not inspect child conversations or prove provider admission.
- Assessment requires two registered Workspaces and both Sensemaking Skills to be available through the receiving Agent's existing DSH Skill registry. Read authorization is separately requested by the existing coordinator. The recorder binds repository ids, `HEAD` revisions, working-tree state, and observation times to a matching successful coordinator tool-result event in the originating Session; it does not independently inspect source contents, citations, or findings. Unavailable, dirty, changed, or stability-unknown sources require an incomplete brief. Saved briefs are agent-authored reports, not independent verification or user acceptance; opening the Activity does not recheck current repository revisions, so present applicability may be uncertain. The assessment installs a request-scoped tool guard bound to the queued instruction and the model turn that claims it. It blocks unrelated model tool calls until the brief is saved or canceled, that claiming turn ends, and any approved coordinator call returns. An unclaimed instruction is removed on cancellation, expiry, command unload, Agent disposal, or the restart/orphan sweep, so it cannot run without its guard. The guard does not change configured permissions; approved repository analysis uses one read-only DSH child Session per selected Workspace.
- Review evidence and its reported result are user supplied and not checked by DSH. The current disposition remains pending until the user changes it; reporting execution success does not accept the outcome.
- `/activity open` labels known provider stop reasons as reported completion, failure, partial output, or refusal; unrecognized reasons remain unknown. It shows report source and time, and uncertainty source category and observation time when available. DSH has no freshness check for a saved report, so it may be stale; opening an Activity does not query later provider state or retry work.
- Product classification uses only the captured bundle list or active preset modules using product-supplied metadata. Profile patches and runtime overlays are not classified; a stable label is limited to an exact shipped profile-template bundle list, and an unclassified preset remains unavailable. These labels do not establish sandbox isolation, permission enforcement, or Skill qualification.
- Recovery guidance offers inspection for pending or uncertain starts. It offers a separately and explicitly initiated request only when the saved outcome supports new work and a provider route is registered; registration does not establish credential readiness, consent, native permission, or admission. Activity exposes no stop action, and external one-shot runs have no Activity status query, transcript inspection, or resume action. Unclassified outcomes remain unresolved.
- Artifact locations, revisions, and Workspace selection are user supplied. The command does not inspect referenced files or infer a Git root from a Workspace directory; missing revisions remain unknown, and pointers do not verify execution context or provider output.

- External handoff source labels, summaries, and artifact references are user supplied. The command does not import external transcripts, synchronize external Sessions, or verify who performed reported work.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
