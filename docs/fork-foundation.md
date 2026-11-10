# Personal fork foundation: multi-harness options

English | [中文](fork-foundation.zh.md)

## Summary

The owner selected DeepSeek Harness as the common execution foundation for a modular coding environment with multiple agent runtimes, repositories, and reusable capabilities. The [proposed development roadmap](../.agents/notes/proposed/feature/2026-11-10-modular-coding-environment-roadmap.md) records the intended direction, candidate sources, provisional priorities, and open decisions. The direction does not select a permanent software-factory controller, override another repository's accepted decisions, or promise a unified native agent session.

The owner-confirmed multi-model Windows pilot is complete. It establishes the multi-model delegation foundation described here; it does not establish multi-repository orchestration, shared native sessions, shared authentication or permission policy, or mission control.

## Reusable capabilities

| Execution path | Existing capability | Limit for the first experience |
| --- | --- | --- |
| DSH native agents | [Managed DSH subagents](../packages/subagent/subagent/README.md) can start, fork, message, and cold-resume continuable in-process agents; a separate [DSH SDK provider](../packages/subagent/subagent-dsh-sdk/README.md) starts an independent Harness runtime. | The two DSH backends have different session and tool visibility. |
| Native Codex | The [Codex bundle](../packages/subagent/subagent-codex/README.md) exposes `subagent_codex` using a pinned native app-server process and one ephemeral thread/turn. | One-shot only; native authentication and model settings; no child transcript, native resume, or rollback. |
| Native Claude Code | The [Claude Code bundle](../packages/subagent/subagent-claude-code/README.md) exposes `subagent_claude_code` using a pinned native SDK/CLI query. | One-shot only; native authentication and settings; no child transcript, native resume, or rollback. |
| Core environment | [Base-backed profiles](architecture.md) compose Cordis plugins, model adapters, filesystem/shell providers, sandbox policy, approvals, and durable Session logs. | A profile layer replaces a row's whole config; plugin presence is not a live authentication or sandbox test. |
| Reusable cognition | The [filesystem Skill provider](../packages/skill/skill-filesystem/README.md) scans project, custom, and user roots for `SKILL.md`, loading bodies on demand. | Skill visibility in DSH does not establish identical discovery or execution in native Codex and Claude Code. |

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

Keep one canonical Sensemaking Skill source. DSH can consume a shared `.agents/skills` directory or configured `customSkillDirs`; verify each native host's discovery independently rather than maintaining edited copies. **Intended authority rule:** a parent should delegate no authority it does not possess. **Unverified enforcement:** the native providers use host-specific credentials, permission modes, and sandbox controls; this reconnaissance did not demonstrate that parent limits constrain worker operations. Until verified, use conservative native permissions and read-only tasks.

Both native bundles run without interactive human prompts and return selected final text or safe diagnostics rather than a detailed child activity stream. They can modify the same working directory, do not automatically revert effects, and need explicit worktree/path isolation before concurrent writes. Begin with sequential, explicitly selected, low-risk tasks.

## Development and verification

Use the compatible Node.js and pnpm versions declared by [the root manifest](../package.json) and follow the [development guide](development.md) for checkout and installation. For any change to this document, maintain the English/Chinese pair and consistency record according to the [bilingual documentation contract](i18n/README.md); run the [repository documentation checks](AGENTS.md) before claiming verification or merging.

Run-specific revisions, environment probes, executed commands, CI status, and blockers belong in the PR verification record, not in this maintained architecture reference.

## Completed multi-model Windows pilot

The owner-confirmed Windows pilot exercised multi-model delegation through the existing DSH integrations. Its completion is evidence of connectivity, not evidence that different providers share a session, authentication, permission policy, workspace isolation, or authority.

## Dev Note

Open questions: which of A/B/C is appropriate after real use, whether a shared Skill directory is supported identically by the installed native host versions, which execution facts can be promoted into durable semantic evidence, and whether any future consolidation earns the cost of migrating existing Dark Factory state. The roadmap records these decisions without selecting an integration.
