---
description: "Review the current authorized Git working tree with a fresh, read-only DSH reviewer. The command separates staged, unstaged, and untracked evidence and reports when its live source changed during review."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-code-review

English | [中文](README.zh.md)

## Summary

Run `/review` in a Web conversation opened at an authorized Git repository to ask a fresh DSH reviewer for findings on staged, unstaged, and non-ignored untracked changes. The reviewer receives repository instructions and a bounded source packet, and has only the Skill loader tool. The command reports the repository, branch, committed revision, reviewer Session and run, and whether the live source changed during analysis. It does not modify repository files or Git state.

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

Start `dsh --profile web`, open a conversation whose working directory is the repository to review, then run `/review` or `/review <focus>`. The Web profile already mounts this command and its `code-reviewer` preset.

### When to choose it

Choose this command for a findings-first review of the current authorized repository without giving a reviewer shell or filesystem tools. Use the ordinary DSH agent when the work needs full source exploration, test execution, or code changes; `/review` sends only the bounded change packet and repository instructions to its child.

### Minimal configuration

The Web profile includes the command. Other Cordis compositions can mount it as a plugin row and must also provide the `code-reviewer` preset with the Skill loader used by the Web profile.

```yaml
- id: command-code-review
  name: '@deepseek-ai/dsh-command-code-review'
  config:
    evidenceReminder: true
```

| Field | Default | Meaning |
|---|---:|---|
| `maxPacketBytes` | `524288` | Maximum rendered source packet size, up to 8 MiB. |
| `maxChangedFiles` | `100` | Maximum changed files considered, up to 1,000. |
| `maxInstructionBytes` | `16384` | Maximum bytes read from one `AGENTS.md` or `CLAUDE.md`, up to 65,536. |
| `maxResultBytes` | `65536` | Maximum reviewer result size, up to 262,144 bytes. |
| `evidenceReminder` | `true` | Append an advisory evidence reminder to the parent turn after a review handoff. |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-command-code-review) lists the accepted fields and bounds. Profile configuration is user-controlled; repository-local `AGENTS.md`, `CLAUDE.md`, and `.agents/skills/code-review/SKILL.md` can supply project-specific review guidance. Existing DSH Skill lookup also makes user Skills available to the reviewer.

### Review behavior

The command reads the current repository selected by the parent Session's working directory and sandbox workspace root. It records the current branch and `HEAD`, separate staged and unstaged Git diffs, and text from non-ignored untracked files. It reads applicable `AGENTS.md` and `CLAUDE.md` instructions from the repository root and changed-file directories. Ignored paths, secret-like names, Git metadata, binary files, and non-regular untracked files are omitted.

The reviewer is a new in-process DSH child Session. Its trusted tool filter allows only `skill`; filesystem, shell, subprocess, delegation, and policy-changing tools are unavailable. The command's own Git subprocess receives a fixed read-only command list, has Git hooks and global configuration disabled, and runs with DSH read-only sandbox policy rooted at the selected repository.

The source packet is a live observation, not an immutable snapshot. The command compares bounded repository evidence before and after capture and again after the review, and rejects a packet that changes during capture. If captured evidence differs after review, the parent handoff marks the findings as potentially stale. The evidence reminder is advisory; it does not grant tools or enforce permission policy.

### Upstream attribution

The findings-first review procedure adapts ideas from Everything Claude Code's reviewer and command workflow and Superpowers' code-review and verification Skills. The shipped DSH Skill uses original wording and contains no copied upstream source. Both upstream repositories declare the MIT license; see the exact sources under [Further Exploration](#further-exploration).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

[`src/index.ts`](src/index.ts) captures and bounds repository evidence, starts the restricted child Session, records its run identity, and returns findings to the parent. The Web bundle provides the `code-reviewer` preset and bundled Skill; project and user Skills are discovered by the existing DSH Skill filesystem.

| File | Responsibility |
|---|---|
| [`src/index.ts`](src/index.ts) | `/review`, bounded Git and filesystem reads, lifecycle handling, and evidence handoff. |
| [`src/git-command.ts`](src/git-command.ts) | Read-only Git verb allowlist and platform null-device selection. |
| [`src/repository-path.ts`](src/repository-path.ts) | Host-aware canonical repository path comparison. |
| [`src/render.ts`](src/render.ts) | Secret-name filtering, captured evidence digests, and reviewer and parent messages. |
| [`../preset/agent-preset/skills/code-review/SKILL.md`](../../preset/agent-preset/skills/code-review/SKILL.md) | Bundled findings-first reviewer guidance. |
| [`../../bundle/web-app/presets/code-reviewer.patch.yml`](../../bundle/web-app/presets/code-reviewer.patch.yml) | Read-only reviewer preset and Skill loader composition. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web app bundle](../../bundle/web-app/README.md) — supported user-facing composition.
- [Commands package](../commands/README.md) — slash-command registration and dispatch.
- [Agent preset package](../../preset/agent-preset/README.md) — child-agent composition and bundled Skills.
- [Skill filesystem](../../skill/skill-filesystem/README.md) — project and user Skill discovery.
- [Everything Claude Code reviewer](https://github.com/affaan-m/ECC/blob/main/agents/code-reviewer.md), [review command](https://github.com/affaan-m/ECC/blob/main/commands/code-review.md), [hooks](https://github.com/affaan-m/ECC/blob/main/hooks/README.md), and [MIT license](https://github.com/affaan-m/ECC/blob/main/LICENSE).
- [Superpowers review Skill](https://github.com/obra/superpowers/blob/main/skills/requesting-code-review/SKILL.md), [reviewer prompt](https://github.com/obra/superpowers/blob/main/skills/requesting-code-review/code-reviewer.md), [verification Skill](https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md), and [MIT license](https://github.com/obra/superpowers/blob/main/LICENSE).

-----

## Model Experience

### Reviewer request

#### What the model sees

The child receives the captured repository packet and the following instruction text, then loads the `code-review` Skill through its sole tool.

##### Reviewer instructions

```markdown
Load the `code-review` Skill before reviewing this captured repository packet.
Review only the supplied content. You have no repository tools except the Skill loader.
Do not modify files, request more tools, or delegate. Report findings with severity, repository-relative path and line, confidence, and the supplied evidence. If no actionable issue is supported, say that no findings are supported.
```

#### Token effect

Each review starts an independent child model request with at most `maxPacketBytes` of rendered repository evidence plus the reviewer instructions and loaded Skill. The Skill loader adds its returned Skill text to the child context.

#### KV Cache effect

The child uses a new Session and therefore an independent model context. Packet content and repository instructions vary by invocation and do not reuse the parent's existing request prefix.

### Parent handoff

#### What the model sees

On successful completion, the command steers the parent with repository path, branch, committed `HEAD`, capture time, source-change status, reviewer Session and run identifiers, stop reason, and the reviewer's findings. The `agent/pre-step` hook may append the advisory evidence reminder.

#### Token effect

The handoff adds a separate user message to the parent's next model request, including the reviewer result up to `maxResultBytes` and the configured evidence reminder.

#### KV Cache effect

The handoff changes the parent's request suffix for this review; it does not replace the earlier parent message history.

## Known Limitations and Deferred Work

- **Partial source context** — the reviewer sees diffs and changed untracked text, not every unchanged file or repository-wide test result, so it must not claim a full repository review.
- **Live working tree** — concurrent edits can make findings stale; comparison detects observed source changes but does not create an immutable read snapshot or detect a change that is later fully reverted.
- **Sensitive-file filtering** — ignored paths and heuristic secret-like filenames are omitted, but filename filtering is not secret scanning and ordinary changed source may itself contain sensitive text.
- **Host support** — the shipped `/review` command is mounted in the DSH Web profile and uses the in-process `spawn` provider. Native Codex and Claude Code delegation and non-Web profile behavior are not qualified by this package.
- **Filesystem identity** — repository containment uses DSH filesystem path identity and cannot identify an in-root hard link whose data originates outside the repository.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The hook only adds model guidance after a matching handoff. Permission enforcement belongs to the child tool filter and read-only execution services.

</details>
