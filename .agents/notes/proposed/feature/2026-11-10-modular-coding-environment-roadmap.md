# Agent Note: Modular coding environment roadmap

Status: proposed

English | [中文](2026-11-10-modular-coding-environment-roadmap.zh.md)

## Problem

The owner selected DeepSeek Harness (DSH) as the common execution foundation for a modular coding-agent environment. The repository already supplies model adapters, agent delegation, Skills, workspaces, durable Sessions, and other composable capabilities. Other repositories describe additional skills, workflows, runtime extensions, intake systems, semantic knowledge, and mission coordination, but their names do not establish that DSH lacks those capabilities or can reuse their implementations unchanged.

Without one durable account of current capability, owner-selected direction, candidate sources, and unresolved choices, future work can mistake a completed connectivity pilot for a multi-repository product, rebuild existing DSH mechanisms, or couple DSH to a separate system without an owner decision.

## Proposal

Keep DSH as the common execution foundation and selectively adapt capabilities that create a demonstrated user or maintainer benefit. Treat this roadmap as a proposal for construction order and decision context, not as authorization to implement every item or as a requirement to follow the list mechanically.

For each next responsibility, identify one bounded outcome, confirm the relevant DSH substrate and source evidence, name authority and integration dependencies, and set observable acceptance criteria before implementation. Revisit the ordering when a real dependency, user need, or verified reuse opportunity changes the construction choice.

### Product direction and capability status

The owner-selected direction is a modular coding environment that can combine multiple model and agent runtimes with work across repositories in a coherent development workflow. Users should be able to compose reusable Skills, specialized agents, commands, and configurable hooks; resume bounded work across sessions; and use adaptive delegation, context management, memory, learning, observability, verification, permissions, and evidence attribution. Advanced Sensemaking and durable mission coordination remain optional capabilities.

The owner-confirmed multi-model Windows pilot is complete. It establishes a multi-model delegation foundation; it does not demonstrate one conversation orchestrating several repositories, shared native sessions, common provider authentication or permission policy, or a mission-control relationship.

| Status | Existing capability | Limit of the evidence |
| --- | --- | --- |
| Demonstrated by the completed pilot | DSH can delegate work through multiple model/runtime integrations; see the [native Codex](../../../../packages/subagent/subagent-codex/README.md) and [Claude Code](../../../../packages/subagent/subagent-claude-code/README.md) providers. | The providers retain host-specific sessions, authentication, settings, and execution controls. Pilot completion does not establish cross-repository orchestration or shared authority. |
| Demonstrated Priority 2 slice | The Web profile provides `/review` with a reusable reviewer Skill, a restricted child preset, and an advisory evidence hook; see [`dsh-command-code-review`](../../../../packages/interaction/command-code-review/README.md). | This is one read-only workflow verified through the production Loader and AgentLoop with a deterministic model adapter; it does not complete the reusable-capability family or qualify live-model and native-provider behavior. |
| Reusable instructions and agents | The [filesystem Skill provider](../../../../packages/skill/skill-filesystem/README.md), [subagent providers](../../../../packages/subagent/README.md), and [agent presets](../../../../packages/preset/README.md) load reusable instructions and compose child agents. | Host discovery and Skill behavior are not identical by assumption; verify each target host. |
| User commands and extension points | DSH exposes [interaction commands](../../../../packages/interaction/README.md), Cordis plugin composition and events, and selected experimental compatibility integrations. | These do not constitute one universal hook API, and a hook does not gain security authority merely by running. |
| Project and task coordination | The [workspace](../../../../packages/workspace/workspace/README.md) groups named projects and Sessions; [teams](../../../../packages/team/agent-team/README.md), [workflows](../../../../packages/workflow/workflow/README.md), [goals](../../../../packages/goal/goal/README.md), [jobs](../../../../packages/jobs/README.md), and [schedules](../../../../packages/schedule/README.md) provide distinct coordination primitives. | A project grouping is not one multi-repository conversation. These primitives do not automatically provide one durable delegated-work product or a Dark Factory Campaign. |
| Session history and context | [Session logs](../../../../packages/session/README.md), [Session queries](../../../../packages/session-query/README.md), [context](../../../../packages/context/README.md), [compaction](../../../../packages/compaction/README.md), and feedback and telemetry packages support reconstruction and observation. | They are not, by themselves, cross-repository semantic memory or an adaptive learning policy. |
| Execution controls | DSH provides credential, approval, and [sandbox](../../../../packages/sandbox/README.md) capabilities alongside provider-specific native controls. | A parent’s policy is not proven to constrain every native child process; permission and evidence rules must be explicit at each integration. |

### Roadmap evidence checkpoint

The roadmap tracks demonstrated developer outcomes, not package presence or local test success alone. This checkpoint distinguishes merged capabilities, unmerged candidate changes, unpublished local work, and unqualified user journeys; it does not revise the provisional priority order.

| Priority | Evidence available | User outcome not yet established |
| --- | --- | --- |
| 1 — Multi-repository | [PR #8](https://github.com/ThorStarlord/deepseek-harness/pull/8) merged a read-only cross-repository analysis workflow. | One authorized conversation completing coordinated changes and review across selected repositories is not demonstrated. |
| 2 — Reusable workflows | [PRs #9–#12](https://github.com/ThorStarlord/deepseek-harness/pulls?q=is%3Apr+is%3Amerged) merged bounded code review, evidence-aware reporting, test-driven guidance, and a composed Web development workflow. | Individual slices do not qualify portability across native agent hosts or one end-to-end multi-agent development experience. |
| 3 — Delegated work | [PR #13](https://github.com/ThorStarlord/deepseek-harness/pull/13) contains child-turn outcomes and cold-read provenance corrections but awaits product/design review. A read-only reconciliation command has been reported on an unpublished local branch. | Neither workstream is integrated as a complete delegate-inspect-reconcile-authorized-continue experience; reported restart and real-model evidence covers bounded cases. |
| 4 — Adaptation and learning | DSH already provides routing, Session history, context, and feedback mechanisms. | Source-linked adaptive decisions and corrected memory affecting authorized later work have not been qualified as one product experience. |
| 5 — Optional advanced integration | Sensemaking and mission-control remain optional candidates, not adopted DSH runtime owners. | Neither integration has an accepted ownership decision and verified end-to-end benefit. |

A pending PR's passing tests do not make its behavior available on canonical master. An unpublished local command is not a reviewed product capability. Keep transient commit details, environment diagnostics, and recording attempts in their owning verification records instead of treating them as roadmap status.

### Candidate source repositories

These candidates are sources for selective evaluation. The references below support only the stated capability descriptions; they do not claim DSH integration or prove that upstream behavior is portable. A repository license applies to that repository's material, not automatically to separate hosted services or dependencies.

| Source and evidence | Capabilities worth evaluating | DSH relationship and likely reuse | Limits, dependencies, and open checks |
| --- | --- | --- | --- |
| [Everything Claude Code (ECC)](https://github.com/affaan-m/ECC) [README](https://github.com/affaan-m/ECC/blob/main/README.md), [MIT license](https://github.com/affaan-m/ECC/blob/main/LICENSE) | Reusable Skills, specialized agents, commands, hooks, rules, memory practices, and multi-host configuration. | DSH already has Skills, agents, commands, plugin extension points, and experimental hook compatibility. Select individual Skill/workflow content or adapt a specific hook/configuration through the owning DSH extension point. | Review each host’s command, tool, and hook semantics before adaptation. Do not assume repository licensing covers the separate ECC Tools service or that its host configuration runs in DSH unchanged. |
| [Superpowers](https://github.com/obra/superpowers) [README](https://github.com/obra/superpowers/blob/main/README.md), [MIT license](https://github.com/obra/superpowers/blob/main/LICENSE) | Skills for brainstorming, implementation planning, test-driven development, debugging, verification, and subagent-driven work; host-specific installation guidance. | DSH’s Skill provider and subagent/workflow mechanisms supply possible homes. Reuse a small set of compatible Skills or re-express a useful workflow as DSH configuration or a plugin. | Upstream installation and tool names vary by host. Check Skill frontmatter, tool assumptions, and each workflow in DSH before calling it portable; do not add the upstream suite wholesale. |
| [DSH Superagent Prototype](https://github.com/ThorStarlord/dsh-superagent-prototype) [README](https://github.com/ThorStarlord/dsh-superagent-prototype/blob/main/README.md), [MIT license](https://github.com/ThorStarlord/dsh-superagent-prototype/blob/main/LICENSE) | Research prototype patterns for GitHub or optional Feishu intake, admission, Tickets and Assignments, worker Sessions, isolated ticket directories, and operator handoff. | DSH already has workspace, subagent, Session, Goal, Job, and Team primitives. Evaluate validated intake or handoff patterns against those owners; any implementation should use DSH’s existing composition and persistence mechanisms where they fit. | The upstream README labels the project a research prototype, not an official or production-ready product. Intake credentials, Feishu, ticket policy, and directory isolation add dependencies; no prototype behavior establishes a production authority model. |
| [Dark Factory](https://github.com/ThorStarlord/dark-factory), with the current comparison in [fork foundation](../../../../docs/fork-foundation.md) | Durable mission authority, Campaign transitions, bounded delegation, evidence admission and reconciliation, protected integration, and recovery. | DSH has adjacent Goal, Workflow, Team, Session, and sandbox capabilities, but they are not equivalent. Keep Dark Factory independent. A future relationship must explicitly select among independent harnesses, a typed layered adapter, or capability-by-capability consolidation. | The repository is private and no public license is declared in the inspected source metadata. Do not reuse source without owner authorization. Do not assume a shared database, identical Goals, inherited authority, or migration permission. |
| [Sensemaking Skills](https://github.com/ThorStarlord/sensemaking-skills) [README](https://github.com/ThorStarlord/sensemaking-skills/blob/main/README.md), [MIT license](https://github.com/ThorStarlord/sensemaking-skills/blob/main/LICENSE) | Local repository understanding, source-linked knowledge, prospective reasoning, and optional construction guidance through reusable Skills. | DSH can load Skills and provides Session query, context, feedback, and telemetry. Those are useful integrations but are not equivalent to a durable semantic repository model. Start with optional Skills or references; consider a DSH plugin only for a validated persistent capability. | The source describes a local-first Python tool and Skills. Transfer across projects, long-term knowledge quality, write authority, retention, and maintenance costs need direct evaluation; do not make it a core dependency by default. |
| [Pi](https://github.com/earendil-works/pi) [README](https://github.com/earendil-works/pi/blob/main/README.md), [MIT license](https://github.com/earendil-works/pi/blob/main/LICENSE) | A minimal agent runtime, a multi-provider model API, Skills, packages, and extension/plugin mechanisms. | DSH already uses pi-ai in its [Pi model adapter](../../../../packages/llm/llm-pi-ai/README.md). Proposed [Pi extensions](2026-10-03-pi-extensions-bridge.md) and [Pi plugins](2026-10-03-pi-plugins-compatibility.md) notes map compatibility gaps; neither proposal is a shipped bridge. Evaluate specific adapters or compatibility levels only when a user needs them. | Pi’s README states that the harness has no built-in permission system and that some agent features are outside its core. DSH must retain its own execution and permission controls. Pi extension and plugin APIs have different maturity and host behavior; recheck the exact version and test each supported capability. |
| [OpenCode](https://github.com/anomalyco/opencode), with the narrow comparison recorded in the [DSH request-recovery note](../../implemented/architecture/2026-06-21-bounded-llm-request-recovery.md) | A bounded request-recovery comparison only. | DSH already owns provider failure handling, visible retry attempts, and durable retry state. The prior comparison can inform a specific future review; it does not identify a missing DSH subsystem or selected integration. | No broad OpenCode capability or license review is recorded here. Verify a pinned upstream source and its license before using it for any new decision. |

### Provisional construction priorities

The owner selected this initial order. Each group names a user outcome and completion evidence; its placement is revisable, and reaching one item does not authorize the next.

#### 1. Multi-repository orchestration in one conversation

**Purpose and user capability:** A user can direct one coherent coding workflow across explicitly selected repositories and understand which repository each action, change, and result belongs to.

**Existing substrate:** DSH has persistent workspace projects, filesystem and process providers, durable Sessions, and subagents. Workspace grouping alone does not make several repositories available to one conversation.

**Dependencies and meaningful completion:** Specify repository membership, working directories or worktrees, branch ownership, per-repository permissions, and result attribution. Demonstrate a user task that reads and changes at least two selected repositories, identifies the source revision for each change, and respects each repository’s independent controls. Do not assume a common native session or credential context.

#### 2. Reusable Skills, specialized agents, commands, and configurable hooks

**Purpose and user capability:** Users can reuse maintained procedures and role-specific agents, invoke named commands, and configure event-driven extensions for their chosen workflow.

**Existing substrate:** DSH has `SKILL.md` loading, subagent providers and presets, interaction commands, Cordis plugins and events, and limited experimental hook compatibility. ECC and Superpowers provide candidate content and patterns.

**Dependencies and meaningful completion:** Define supported configuration, composition, ordering, lifecycle, host compatibility, and error reporting for each adopted mechanism. A useful release lets a user enable one documented Skill, agent, command, and hook in a supported profile, verifies each behavior, and states where host semantics differ. Keep enforcement authority in explicit policy owners; a callback alone is not a permission system.

#### 3. Persistent delegated work and bounded autonomous continuation

**Purpose and user capability:** Users can delegate a scoped task, leave or restart the parent conversation, and later inspect, continue, cancel, or accept the child result within stated limits.

**Existing substrate:** DSH already has durable Sessions, continuable subagents, per-Session Goals, team task boards, workflows, background jobs, and scheduled follow-ups. These have different owners and lifetimes; this direction may be composition or focused product work rather than new infrastructure.

**Dependencies and meaningful completion:** Define task ownership, durable status, resume and cancellation behavior, autonomy limits, evidence returned to the parent, and recovery after process loss. Verify a delegated task across the relevant restart and failure cases. Do not equate these primitives with Dark Factory Campaign authority.

#### 4. Adaptive orchestration, memory, context management, and learning

**Purpose and user capability:** The environment can select useful delegation and context actions from observed work while retaining inspectable evidence and allowing the user to correct or constrain the result.

**Existing substrate:** DSH has provider routing, context assembly, compaction, Session search and tracing, feedback, and telemetry. It does not thereby provide persistent cross-repository semantic memory or a validated learning policy.

**Dependencies and meaningful completion:** First define which data may be retained, who can read or change it, how evidence is attributed and corrected, and which actions require approval. Complete a bounded workflow where a user can inspect the source evidence behind one adaptive choice, correct a wrong memory, and observe that the correction affects only authorized future work.

#### 5. Advanced Sensemaking and optional mission-control integration

**Purpose and user capability:** Users may add source-linked repository reasoning or durable mission coordination when a concrete workflow benefits from it, without making either requirement for ordinary DSH coding.

**Existing substrate:** Sensemaking Skills can be evaluated as optional reusable guidance. DSH has Session and task coordination primitives. Dark Factory remains a separate system with distinct authority and campaign records.

**Dependencies and meaningful completion:** Establish the user value and data/authority model for each optional capability separately. A Sensemaking adoption needs verified output quality, sources, and lifecycle behavior. A Dark Factory relationship needs a new explicit owner decision, a chosen A/B/C relationship, and defined typed authority and evidence exchange before implementation. Continued independence is a valid outcome.

### Architectural boundaries and unresolved choices

Keep these distinctions explicit when selecting work:

- Multiple model providers do not imply multi-repository orchestration.
- Native Codex and Claude Code do not share one Session, authentication context, or permission policy by default; DSH adapters do not erase host-specific controls.
- Portable `SKILL.md` files may rely on host-specific tools or conventions. Verify each target host rather than promising uniform behavior.
- DSH Tasks, Goals, Workflows, Teams, and Sessions have separate contracts; none is equivalent to a Dark Factory Campaign.
- A hook may observe or transform an event only within its configured runtime. Security enforcement requires an explicit authority and policy path.
- Evidence needs source, repository, Session or run, agent/provider, and relevant permission context wherever those facts affect review or acceptance.
- Dark Factory remains independent until a future explicit decision chooses another relationship. The existing A/B/C alternatives remain open.

The order of repository selection, worktree ownership, and branch integration for a multi-repository conversation remains open. The user-facing model for hook configuration and host-specific Skill discovery remains open. The retention, correction, and authority model for semantic memory remains open. The runtime and recovery model for continuing work after restart remains open. None should be silently resolved by selecting a source repository or by reusing a similarly named DSH primitive.

### Selecting the next bounded responsibility

Choose one user or maintainer outcome from this roadmap only when repository evidence supports it. Inspect the current package owner and its documented behavior first. Check the candidate source and license when external material matters. Separate existing mechanisms from the actual gap, and state integrations, permissions, and source attribution before choosing a design. Define a small, observable acceptance result and the relevant repository-prescribed verification. If authority, dependency, or user value is unresolved, record that decision boundary instead of implementing an assumption.

### Priority 3 lessons and strategic reassessment

Recovery investigations distinguish persisted Session events, synthetic cold-read closers, current repository observations, and interpretations. A durable `tool/call` without a durable result remains uncertain even if the intended file exists now: a matching postcondition does not prove which operation caused it. Cold inspection must not replay side effects, promote reconstructed evidence to a durable outcome, or grant continuation authority.

Those investigations also showed that existing Session persistence, repair, query, and subagent mechanisms already cover much of the needed behavior; introduce infrastructure only for a demonstrated missing responsibility. Deterministic tests, OS-process restart probes, genuine model-backed Web runs, reviewed PRs, and integrated user workflows establish different claims. A difficult recording, unmerged branch, or unanswered product/design review is a qualification or publication dependency, not proof of a new runtime defect.

A succession of individually warranted fixes can consume engineering effort without delivering the complete product experience. Before choosing further Priority 3 construction, reassess all five priorities against a coherent developer workflow from intent and authorized delegation to an attributable, inspectable engineering result. Separate existing mechanisms, merged capabilities, unpublished work, missing integrations, unqualified behavior, and review or environment constraints. Select the next bounded responsibility for its contribution to end-to-end user value rather than proximity to the previous subtask; this is a strategic checkpoint, not a mandatory analysis gate for every change.

One possible comparison workflow is a developer assigning a bounded task to specialized agents across explicitly selected repositories and receiving reviewable changes with source and permission attribution. This is a candidate for evaluation, not an adopted reprioritization or authority to couple DSH to Dark Factory.

## Alternatives considered

**Import one framework as the product architecture.** Rejected because the candidate repositories have different runtimes, permissions, persistence, maturity, and licensing. DSH already supplies useful execution infrastructure, and adopting a complete framework would couple unrelated product decisions.

**Recreate Dark Factory inside DSH.** Rejected because similar names do not establish equivalent mission authority, campaign transitions, evidence admission, or recovery. The relationship remains an explicit future decision; Dark Factory keeps its current ownership meanwhile.

**Treat the completed multi-model pilot as the next product.** Rejected because it establishes provider connectivity and delegation, not the multi-repository workflow or shared authority the owner selected for further development.

**Put the roadmap in always-loaded instructions or architecture reference.** Rejected because the roadmap is proposed strategic direction, not a standing order or current architecture contract. This proposed Agent Note owns the rationale; the existing fork-foundation page links to it for discovery.

## Acceptance criteria

- A new coding agent can find the selected DSH foundation and provisional priority order from the fork-foundation page.
- The note distinguishes the completed multi-model pilot and existing DSH capabilities from proposed work.
- Each required candidate source has evidence links, a bounded capability description, a DSH comparison, a likely adaptation form, and its meaningful limitations or license status.
- The note states the requested architectural boundaries, keeps Dark Factory independent, and records unresolved choices without deciding them implicitly.
- Chinese and English counterparts mirror the structure and their pairing record is regenerated.
- Documentation checks pass, except for an already established Windows-only symlink failure that is reported with its exact evidence and no other failure is concealed.

## Risks

- Upstream features, names, and licenses can change; implementation work must recheck the exact source and version instead of treating this inventory as a permanent endorsement.
- An inventory can become a second, stale capability catalog. Package READMEs and source remain authoritative for what DSH currently does; this note owns only the strategic comparison and open construction choices.
- A priority can be mistaken for a commitment or dependency. Revisit its order when a concrete task provides new evidence, and do not implement a later group only because an earlier group was completed.
- Similar workflow terms can hide different authority or persistence. Keep each integration explicit and preserve independent runtime, authentication, permission, and evidence controls.
