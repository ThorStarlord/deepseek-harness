---
description: "Coordinate work across two selected local Git Workspaces and review each child Session's attributed result and Git evidence."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-multi-repository

English | [中文](README.zh.md)

## Summary

`coordinate_repositories` starts one fresh in-process DSH child Session for each of exactly two selected Workspace Git repositories. Each child works in a separate clean clone at the captured commit, leaving its changes available for review. The parent receives both results with source identity, child run, and Git evidence, then can reconcile the changes in one response.

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

Load this plugin when a user-started conversation needs to coordinate one coding task across two registered local Git Workspaces.

### When to choose it

Choose it when the caller can name exactly two repository roots and needs separate child Sessions, clones, and results. The Web application's standard profile already mounts it; another composition must supply the Workspace registry, sandboxed filesystem and shell, subprocess and sandbox policy services, and an in-process subagent provider that advertises `permissionRoot`.

### Minimal configuration

Add the plugin row to an existing DSH composition that provides those services:

```yaml
- name: '@deepseek-ai/dsh-tool-multi-repository'
  config:
    providerName: spawn
```

| Field | Default | Meaning |
|---|---|---|
| `providerName` | `spawn` | In-process subagent provider used for the two repository children |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-multi-repository) lists every accepted field.

Both supplied Workspace roots must be absolute, registered, local Git repository roots with clean working trees, and they must have distinct Git common directories. The task is shared, while each child reads and changes only the clone prepared for its own selected repository.

The plugin stores clones under `DSH_HOME`, removes their `origin` remotes, and starts a unique branch from each captured `HEAD`. It leaves source checkouts unchanged and does not merge results back into them.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The coordinator validates repository identity and Git state before cloning. It prepares two independent clones, starts one caller-delivered DSH child Session per clone with that directory fixed as its permission root, waits for both outcomes, and returns separate repository rows to the parent.

The Subagent provider capability makes the child Session's immutable `cwd` its DSH `workspace-write` root. The coordinator refuses write-capable Git setup unless the sandbox reports full enforcement and refuses global extra writable roots, because either could grant writes outside the selected clone.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Register the tool, validate selected repositories, prepare clones, delegate child Sessions, and report Git evidence |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Workspace registry](../workspace/README.md) — registered project identity and local directory records.
- [Subagent service](../../subagent/subagent/README.md) — child Session lifecycle and provider capabilities.
- [Sandbox policy](../../sandbox/sandbox-policy/README.md) — per-Session file permissions and platform behavior.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-multi-repository) — model-visible parameters and result fields.

-----

<a id="model-experience"></a>
## Model Experience

### Coordination tool

#### What the model sees

Each parent request includes the `coordinate_repositories` tool schema for exactly two Workspace roots and one task; the generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-multi-repository) owns its exact parameters and result fields. A call returns one row per repository with its source Git identity and commit, child Session and run id, clone branch, outcome, final Git state, and child report.

##### Tool call example

```markdown
User request: "Make the same check in /workspace/api and /workspace/cli."
Tool arguments: {"repositories":["/workspace/api","/workspace/cli"],"task":"Add the same check and report each repository's diff."}
```

#### Token effect

The schema and its short description are included while the plugin is active; a call adds the task, two result rows, and child reports to the parent conversation.

#### KV Cache effect

The schema remains a stable request prefix while the plugin registration is unchanged. Tool calls and results append to the conversation; changing the active plugin composition may invalidate reuse from the affected request prefix.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

The tool is limited by the permissions and execution providers available to the existing DSH composition.

- **Filesystem reads remain broad** — DSH allows reads outside a Session root, so selecting repositories does not prevent the child from reading other paths.
- **Temporary paths retain write grants** — the current DSH sandbox permits writes in operating-system temporary areas, including an unregistered repository there.
- **Write support depends on enforcement** — Windows ACL reports partial enforcement and the tool refuses clone setup; native Codex and Claude Code providers do not advertise the DSH `permissionRoot` capability.
- **Changes stay in clones** — both source repositories must start clean, and the tool does not create a pull request, merge a branch, or modify the source checkout.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
