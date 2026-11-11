---
description: "Coordinate read-only analysis across two selected local Git Workspaces, including their current staged and working-tree state."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-multi-repository

English | [中文](README.zh.md)

## Summary

`coordinate_repositories` starts one read-only DSH child Session for each of exactly two selected, registered local Git Workspaces. Each child inspects its own live working tree and returns repository, Session, run, Git-state, and source-evidence attribution to one parent conversation. The tool does not modify either repository.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Load this plugin when a user-started conversation needs read-only analysis of one task across exactly two registered local Git Workspaces.

### Selection and authorization

Both selected paths must be absolute registered Workspace roots and distinct Git repository identities. Before repository contents are inspected, the existing approval flow asks the user to approve the exact two roots and task for this operation. Registration alone does not authorize access, and read authorization does not grant write permission.

### Repository state

Each child receives one repository's root instructions, current branch and committed `HEAD`, staged paths, unstaged paths, untracked non-ignored paths, and an ignored-file count. Working-tree reads observe live file contents; staged reads use the Git index. DSH does not create an immutable snapshot, stash changes, or copy, commit, reset, or clean the source repositories.

The result identifies each Workspace and Git directory, child Session, run, stop reason, and findings. It reports the observation interval and whether a final Git and filesystem check detected a source-state change. Treat findings as potentially stale when the source changed or could not be rechecked.

### Minimal configuration

Add the plugin to a DSH composition that provides `workspaceRegistry`, `fs`, `subprocess`, `sandbox`, `subagents`, `agentPresets`, and a user-answerable approval service:

```yaml
- name: '@deepseek-ai/dsh-tool-multi-repository'
  config:
    readOnlyAgentPreset: multi-repository-read-only
    providerName: spawn
```

| Field | Default | Meaning |
|---|---|---|
| `readOnlyAgentPreset` | `multi-repository-read-only` | Persona-only preset mounted for each analysis child |
| `providerName` | `spawn` | In-process DSH provider that supports a pinned read-only policy and child tool restriction |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-multi-repository) lists every accepted field.

The Web application profile supplies the read-only preset and this tool. Other compositions must supply equivalent services and a provider that explicitly supports both read-only policy pinning and trusted child tool restrictions. Providers with different native permission contracts are rejected when they do not advertise those capabilities.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

The parent tool call uses the existing one-shot approval path before repository inspection. The coordinator then validates both Workspace identities and runs one child Session per root. Each child is pinned to the DSH `read-only` sandbox policy and receives only `repository_list_files`, `repository_read_file`, and `read_staged_file`. It has no generic filesystem, shell, subprocess, write, child-delegation, or sandbox-policy tool.

The repository read tools check every requested path against that child's selected root, omit ignored and secret-like paths, and bound returned file content. The coordinator reports Git state independently for each root and returns both worker outcomes to the same parent Session.

On Windows, the ACL sandbox reports partial enforcement and its restricted token cannot read ordinary user-owned repository files. Fixed, internally constructed Git read commands therefore run through the host subprocess provider; the child still receives no subprocess tool or caller-controlled command. These Git reads are not OS-confined on Windows. Tool-level file reads remain rooted at the selected Workspace, but this is not process-level read confinement.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Register the coordination and repository-read tools, validate selections, run children, and attribute results |
| [`src/read-only-git-command.ts`](src/read-only-git-command.ts) | Restrict internal Git commands and select the host null-device path |
| [`tests/workflow.spec.ts`](tests/workflow.spec.ts) | Exercise two dirty repositories, authorization, tool restrictions, source changes, failures, and cancellation |
| [`tests/loader-composition.spec.ts`](tests/loader-composition.spec.ts) | Exercise the read-only workflow through the shipped headless profile and Loader |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Workspace registry](../workspace/README.md) — registered project identity and local directory records.
- [Subagent service](../../subagent/subagent/README.md) — child Session lifecycle and provider capabilities.
- [Sandbox policy](../../sandbox/sandbox-policy/README.md) — per-Session permissions and platform behavior.
- [Generated tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-multi-repository) — model-visible parameters and result fields.

-----

<a id="model-experience"></a>
## Model Experience

### Coordination tool

#### What the model sees

The parent receives one result row per selected repository. Each row identifies current `HEAD` and branch, staged, unstaged, untracked, and ignored state, the child Session and run, the observation interval, and findings with source evidence. The child sees only the selected repository's root instructions and bounded read tools for live working-tree files, index versions, and file lists.

##### Tool call example

```markdown
User request: "Compare the parser integration in C:\work\api and D:\work\cli."
Tool arguments: {"repositories":["C:\\work\\api","D:\\work\\cli"],"task":"Analyze the parser integration and cite the relevant working-tree and staged source in each repository."}
```

#### Token effect

The schema and short description are included while the plugin is active; a call adds one repository-attributed result per child to the parent conversation.

#### KV Cache effect

The schema remains a stable request prefix while the plugin registration is unchanged. Tool calls and results append to the conversation; changing the active plugin composition may invalidate reuse from the affected request prefix.

## Known Limitations and Deferred Work
<a id="known-limitations-and-deferred-work"></a>

- **Exactly two roots** — one call accepts exactly two distinct registered local Git Workspaces.
- **Live source** — workers read the current working tree and index over time, not an immutable snapshot. Concurrent edits can make findings stale; the returned state check is best-effort.
- **Ignored and secret-like files** — ignored file contents are not automatically included. Secret-like paths and `.git` metadata are excluded from file reads.
- **Path-based read containment** — the filesystem checks resolved paths inside each selected root, but its metadata does not detect hard-link aliases. A selected tree can contain an in-root hard link to data stored elsewhere, which DSH cannot identify as an external file.
- **Windows OS confinement** — fixed Git inspection commands run as the host process because Windows ACL enforcement is partial. The child has no model-facing process tool, but Windows does not confine these internal Git reads at the process level. DSH file-read tools check containment within the selected root.
- **No write workflow** — this capability does not create clones or modify source files, the index, or Git state. Write-capable coordination remains unavailable pending separate security qualification.

<a id="dev-note"></a>
### Dev Note

None.
