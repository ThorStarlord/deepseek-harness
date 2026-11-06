# Personal fork foundation: multi-harness options

English | [中文](fork-foundation.zh.md)

## Summary

This personal fork explores DeepSeek Harness as a modular coding environment alongside native Codex, native Claude Code, portable Sensemaking Skills, and optional durable mission coordination. It does not select a permanent software-factory controller, override another repository's accepted decisions, or promise a unified agent session.

The first usable experience is explicit delegation among three execution paths, bounded work, and review of the actual repository result. Implementation of new routing, adapters, storage, or orchestration is outside this foundation.

## Reusable capabilities

| Execution path | Existing capability | Limit for the first experience |
| --- | --- | --- |
| DSH native agents | [Managed DSH subagents](../packages/subagent/subagent/README.md) can start, fork, message, and cold-resume continuable in-process agents; a separate [DSH SDK provider](../packages/subagent/subagent-dsh-sdk/README.md) starts an independent Harness runtime. | The two DSH backends have different session and tool visibility. |
| Native Codex | The [Codex bundle](../packages/subagent/subagent-codex/README.md) exposes `subagent_codex` using a pinned native app-server process and one ephemeral thread/turn. | One-shot only; native authentication and model settings; no child transcript, native resume, or rollback. |
| Native Claude Code | The [Claude Code bundle](../packages/subagent/subagent-claude-code/README.md) exposes `subagent_claude_code` using a pinned native SDK/CLI query. | One-shot only; native authentication and settings; no child transcript, native resume, or rollback. |
| Core environment | [Base-backed profiles](architecture.md) compose Cordis plugins, model adapters, filesystem/shell providers, sandbox policy, approvals, and durable Session logs. | A profile layer replaces a row's whole config; plugin presence is not a live authentication or sandbox test. |
| Reusable cognition | The [filesystem Skill provider](../packages/skill/skill-filesystem/README.md) scans project, custom, and user roots for `SKILL.md`, loading bodies on demand. | Skill visibility in DSH does not establish identical discovery or execution in native Codex and Claude Code. |

The smallest candidate uses an existing base-backed Web or headless profile, its built-in DSH subagent tools, and the two optional native bundles. Enable the bundles through the supported profile/plugin mechanism; do not create another launcher or mount an application outside `dsh` profiles.

## Related repository responsibilities

| System | Present responsibility | Important boundary |
| --- | --- | --- |
| This DSH fork | Agent/model and tool execution, workspace and safety providers, Session persistence, subagents, bounded workflow runs, goals, and team task coordination. | A Session, workflow, or task board is not automatically a durable software-production Campaign. |
| [Sensemaking Skills](https://github.com/ThorStarlord/sensemaking-skills) | Ontology-grounded repository understanding, prospective reasoning, source-linked knowledge, and optional portable construction guidance through `using-sensemaking`. | Its graph and guidance do not authenticate workers or authorize edits, merges, releases, or deployments. |
| [Dark Factory](https://github.com/ThorStarlord/dark-factory) | Authorized Goal revisions, Strategic Frontier assessment, Delegation limits, persistent Campaign transitions, evidence admission/reconciliation, protected integration, and recovery. | Its accepted Sensemaking/Archon ownership applies to Dark Factory today; it is not a permanent veto on alternative fork designs. |
| [DSH superagent prototype](https://github.com/ThorStarlord/dsh-superagent-prototype) | Research-grade GitHub/optional Feishu intake, admission policy, Tickets, Assignments, DSH worker Sessions, isolated ticket directories, and operator handoff. | A working prototype pattern is not production qualification or the same authority model as Dark Factory. |
| Native Codex and Claude Code | Their own product instructions, account authentication, models, sandbox/permission decisions, and execution semantics. | DSH delegation does not erase or unify those native controls. |

The overlapping nouns are not equivalent: [DSH Goal](../packages/goal/goal/README.md) retains one Session objective and does not itself schedule work, whereas Dark Factory `GoalRevision` records authorized product intent. [DSH Workflow](../packages/workflow/workflow/README.md) coordinates one caller-owned script run, whereas Dark Factory Campaign admits transitions, evidence, and recovery across execution. [DSH Team](../packages/team/agent-team/README.md) persists a compare-and-set task board in a shared checkout, whereas Dark Factory Delegation bounds which consequential Campaigns may be authorized. A Session log reconstructs model-visible history; a Campaign journal records distinct decisions, authority, and accepted evidence.

## Unselected architectural relationships

- **A. Independent harnesses:** DSH and Dark Factory can evolve independently, preserving native strengths and avoiding coupling; the cost is separate operator workflows and knowledge exchange, and integrations must not silently write each other's state.
- **B. Layered integration:** Dark Factory can continue to own durable missions while it calls bounded DSH execution, gaining native Codex/Claude paths; the dependency is a typed request/result/evidence adapter and explicit authority mapping, not a shared database or assumed equality of goals.
- **C. Selective consolidation:** A future DSH plugin could adapt validated Dark Factory capabilities and retire actual duplicates, reducing operator fragmentation; this requires capability-by-capability parity, migration, protected-transition design, and explicit replacement decisions before retiring any live owner.

These are possible relationships, not a ranking or an implementation authorization.

## Instructions, shared skills, and authority

[DSH workspace instructions](../packages/context/agent-instructions/README.md) load user-level and project-level `AGENTS.md` and `CLAUDE.md` candidates plus local overlays; the two root files in the inspected fork have identical content. Filenames alone therefore do not establish a conflict. Codex and Claude Code still apply their native instruction and permission systems, and project rules govern work in the target repository. No host's hooks, approvals, or session identifiers are interchangeable by default.

Keep one canonical Sensemaking Skill source. DSH can consume a shared `.agents/skills` directory or configured `customSkillDirs`; verify the native hosts' actual discovery separately rather than maintaining independent edited copies. A parent must authorize the bounded task and constrain the child to no greater authority, even when a native runtime could technically request more.

Both native bundles run without interactive human prompts and return selected final text or safe diagnostics rather than a detailed child activity stream. They can modify the same working directory, do not automatically revert effects, and need explicit worktree/path isolation before concurrent writes. Begin with sequential, explicitly selected, low-risk tasks.

## Reproducibility record

Inspection date: 2026-11-06. The GitHub API showed fork `master` and upstream `master` at the same starting revision; the immutable identifier is captured in the foundation PR's base metadata and description rather than embedded here, consistent with the repository-reference checker. Remote comparison found no fork divergence. The user's own local worktree and uncommitted modifications could not be inspected from this environment.

| Observation | Result |
| --- | --- |
| Available execution host | Linux x86_64; `node --version` returned `v22.16.0`; `git --version` returned `2.47.3`; `corepack --version` returned `0.32.0`. |
| Package manager | `pnpm` not installed; root `package.json` requires Node `>=24.9.0` and `pnpm@11.28.5`; published DSH root version is `0.2.2-rc.1`. |
| Local checkout | No fork checkout mounted; `git -C /mnt/data status --porcelain` failed because that directory is not a Git repository. Network Git access could not resolve `github.com`. |
| Verification actually performed | GitHub source, package manifests, cross-repository documentation, current branch metadata, and provider contracts were inspected; the Node/Git/Corepack version commands were run. |
| Verification not performed | No `pnpm install --frozen-lockfile`, `pnpm run test:docs`, `pnpm run doc-sync`, `pnpm run lint`, `pnpm run build`, `pnpm dsh --profile web --dump-config`, or model-backed run. None can be called passed. |

On an accessible checkout with compatible Node and pnpm, use the repository's existing instructions to run `pnpm install --frozen-lockfile`, `pnpm run test:docs`, `pnpm run doc-sync`, `pnpm run lint`, `pnpm run build`, and `pnpm dsh --profile web --dump-config`. Use the existing source launch for a bounded model task only after configuring credentials outside Git; preserve the output and failure diagnostics. This paragraph is a reproduction procedure, not an execution receipt.

## Next bounded responsibility

Configure and verify one personal DSH profile with the existing DSH child path and both native subagent bundles, without changing provider code. Confirm the resolved profile through `--dump-config`; verify each provider with one explicitly selected, read-only repository question in a separate safe workspace; compare each returned answer with the repository source; record authentication blockers, native approval behavior, observable Session events, and unchanged working-tree state. Do not introduce a router, shared session database, automatic factory mission dispatch, or concurrent write delegation.

## Dev Note

Open questions: which of A/B/C is appropriate after real use, whether a shared Skill directory is supported identically by the installed native host versions, which execution facts can be promoted into durable semantic evidence, and whether any future consolidation earns the cost of migrating existing Dark Factory state. None is resolved by this documentation-only reconnaissance.
