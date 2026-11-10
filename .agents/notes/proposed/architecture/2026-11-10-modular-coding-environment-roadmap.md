# Agent Note: Modular coding environment roadmap

Status: proposed

English | [中文](2026-11-10-modular-coding-environment-roadmap.zh.md)

## Problem

DeepSeek Harness already provides a Cordis plugin foundation, DSH subagents, native Codex and Claude Code delegation adapters, a filesystem Skill provider, durable Sessions, and several task and workflow mechanisms. The existing `docs/fork-foundation.md` describes their distinct responsibilities, but it was written before the owner's completed Windows multi-model pilot and does not establish a broader modular product-development direction.

Without one durable proposal, future agents could repeat completed multi-model work, equate one-shot multi-model delegation with multi-repository orchestration, absorb unrelated software-factory responsibilities, or import external projects without checking whether DSH already provides the needed mechanisms.

## Proposal

The owner selects DeepSeek Harness as the common execution foundation for an extensible coding environment. Future construction should favor composable Cordis plugins, profiles, adapters, configuration, specialized agents, Skills, commands and hooks over replacement runtimes. Reuse existing packages before proposing a new subsystem. External repositories supply candidate methods or components, not inherited product authority.

The order below is a provisional exploration and construction preference, not a requirement to build every item. A future agent selects one bounded responsibility from current user value, dependencies, source evidence, risk and authorized scope; it may reorder or decline items with a recorded reason. The goal is a coherent multi-model, potentially multi-repository user experience, not a catalogue of integrations.

## Existing foundation and claim limits

Core Cordis profiles compose model providers, filesystem and shell tools, sandbox and approval providers, and append-only Session history (`docs/architecture.md`). The subagent family includes managed DSH children and an independent DSH SDK provider; `packages/subagent/subagent-codex/` and `packages/subagent/subagent-claude-code/` expose native external one-shot delegates. `packages/skill/skill-filesystem/` discovers and loads local Skills. Existing Goal, Workflow, Team, Jobs, Schedule, context and compaction packages provide narrower, separately owned pieces of continuity.

The owner reports that the Windows three-agent multi-model pilot is complete; PR #5 is merged into the inspected fork baseline. This is a completed technical foundation, not an unfinished roadmap item. The repository's existing native-provider descriptions constrain what the pilot can establish: native child sessions, credentials, permissions, transcript visibility and rollback remain host-specific. This documentation exercise has not independently reproduced that pilot or qualified a multi-repository conversation.

## Candidate source repositories

**[Everything Claude Code (ECC)](https://github.com/affaan-m/ECC) — Skills, specialized agents, commands, rules, hooks and context/learning practices.** Candidate reuse: selective Skill/command adaptation, configuration and carefully mapped hook events. DSH already has Skill loading, subagents and extension events; parity with ECC's supported hosts is unverified. The inspected upstream repository contains an MIT license. Use the current `affaan-m/ECC` location, not an unofficial mirror.

**[Superpowers](https://github.com/obra/superpowers) — composable software-development Skills and design-to-implementation methodology.** Candidate reuse: individual methods and agent guidance rather than a replacement orchestrator. DSH already runs agents and tasks; behavioral fit and invocation differences remain untested. The upstream repository contains an MIT license.

**[DSH Superagent Prototype](https://github.com/ThorStarlord/dsh-superagent-prototype) — GitHub/optional Feishu intake, admitted tickets, worker Sessions, isolated work directories and operator handoffs.** Candidate reuse: bounded intake, work-unit and recovery patterns via DSH-native plugins. It is explicitly research code, focused on one GitHub repository, not production qualification. The inspected repository contains an MIT license.

**[Dark Factory](https://github.com/ThorStarlord/dark-factory) — authorized Goal revisions, Campaign transitions, evidence, protected integration and recovery.** Candidate reuse: conceptual mission governance or future explicit evidence adapters, not shared databases, automatic absorption, or equality with DSH Goals, Workflows, Tasks and Sessions. Dark Factory remains independent. A root `LICENSE` was not established during this inspection: no code reuse is authorized on that assumption.

**[Sensemaking Skills](https://github.com/ThorStarlord/sensemaking-skills) — ontology-grounded repository understanding, exploratory reasoning, durable source-linked knowledge and authority-aware reconciliation.** Candidate reuse: portable Skills and optional source/evidence adapters, with the active agent retaining semantic decisions. Existing DSH Skill discovery does not prove native-host portability or behavioral value. The inspected upstream repository contains an MIT license.

**[Pi](https://github.com/earendil-works/pi) ecosystem — an additional, previously investigated compatibility candidate.** Existing `2026-10-03-pi-extensions-bridge.md` and `2026-10-03-pi-plugins-compatibility.md` proposed Agent Notes map its extension/plugin concepts to DSH mechanisms. Both remain proposals, not implemented equivalence; recheck upstream API and license before any adaptation.

## Provisional construction priorities

Each group describes a desired user experience, reusable DSH mechanisms, unresolved dependencies and a meaningful completion observation. A group can be investigated before it is built, and completion of one does not automatically authorize the next.

### 1. Multi-repository orchestration in one conversation

**Purpose and user experience.** An agent can pursue one authorized development objective across two or more explicitly selected repositories without mixing up their identities, instructions, working trees, tool results or permissions. Existing workspace, worktree, subagent, Team and Session mechanisms are candidate building blocks, not evidence that this experience already works.

**Dependencies and completion.** Investigate target identity, repository selection, workspace isolation, per-target authorization, commit ownership, cross-repository dependency evidence and failure recovery. Meaningful completion is a real bounded two-repository task coordinated from one conversation, with reproducible per-target changes and evidence, no unintended cross-target mutation, and an understandable recovery path.

### 2. Reusable Skills, agents, commands and hooks

**Purpose and user experience.** An operator can enable, inspect, customize and selectively reuse capabilities without maintaining divergent copies for each model host. Reuse DSH filesystem Skills, subagent providers, plugin profiles, command registration and lifecycle/tool events; examine ECC and Superpowers as method libraries, and the proposed Pi compatibility work as a separate option.

**Dependencies and completion.** Specify version ownership, discovery precedence, disabled/unsafe capability handling, host-specific invocation, hook ordering and error behavior. A hook that observes or rejects a DSH tool call does not automatically constrain an independently authenticated Codex or Claude worker. Completion is a documented, exercised composition across a DSH Skill, a specialized delegate, a command and a controlled hook, with visible differences and no permission escalation.

### 3. Persistent delegated work and autonomous continuation

**Purpose and user experience.** A permitted long-running task survives an interruption and can resume without losing its owner, current objective, progress, admitted evidence or escalation requirements. Reuse DSH Sessions, Goal, Team tasks, Workflow, Jobs and Schedule before adding a new mission entity; inspect the Superagent prototype's ticket and worker lifecycle.

**Dependencies and completion.** Resolve authority scope, idempotency, lease and ownership recovery, cancellation, side-effect recording, human handoff and worker result admission. A DSH Task, Goal, Workflow or Session is not a Dark Factory Campaign. Completion is an interrupted authorized task that resumes to an evidence-backed outcome or explicit stop, without duplicate protected effects.

### 4. Adaptive orchestration, memory, context and learning

**Purpose and user experience.** The environment retrieves decision-relevant prior context, delegates according to task and host constraints, learns from observed outcomes, and avoids repeating previously resolved uncertainty. Existing model adapters, request context, compaction and event-sourced Session projections provide inputs; they do not establish adaptive policy quality or learning.

**Dependencies and completion.** Separate ephemeral context, persisted task history, product-semantic knowledge, model routing and authority to act. Measure a bounded continuation in which prior verified knowledge changes an agent's next useful action without stale facts or unbounded token cost. Do not add a memory engine until a concrete missing capability is demonstrated.

### 5. Advanced Sensemaking and optional mission coordination

**Purpose and user experience.** Advanced repository understanding and prospective reasoning can inform bounded DSH execution, while optional mission coordination can preserve longer-lived evidence and approvals when a genuine user need requires it. Use Sensemaking's portable Skills and source-linked knowledge selectively. Dark Factory remains an independent product and possible future counterpart, not a subsystem to absorb by default.

**Dependencies and completion.** Define explicit request/result/evidence adapters, source revision identity, semantic ownership, approval and publication boundaries, and data portability before attempting deeper coupling. A first meaningful completion is an agent invoking bounded Sensemaking guidance, executing only separately authorized DSH work, and returning reconstructible evidence. A factory-scale controller requires its own future product decision and qualification.

## Open architectural decisions

Multi-repository execution might begin sequentially or require concurrent isolated workers; the correct choice depends on real user tasks and target-level failure behavior. Whether repository identity belongs in Session metadata, a workspace registry or a separate adapter remains undecided. Native child authentication, sandboxing and permission scope cannot be assumed to inherit parent policy.

Portable Skills may be shared from one source directory, but host-specific discovery, invocation and cancellation need observation. DSH's own tool/lifecycle hooks are not a cross-provider security policy. Memory may remain an assemblage of Session history and optional external semantic knowledge until a demonstrated gap warrants unification. Any future coordination with Dark Factory needs a separately selected ownership and evidence-transfer relationship.

## Alternatives considered

**Import every candidate repository.** Rejected as a default: code ownership, plugin lifecycles, overlapping Skills and security semantics would become opaque, while multiple imports might implement existing DSH functions again.

**Make Sensemaking or Dark Factory the mandatory execution controller.** Rejected as the roadmap default: Sensemaking owns semantic reasoning methods and Dark Factory owns its accepted production-governance model; neither automatically replaces DSH's execution foundation.

**Build a new universal multi-agent runtime first.** Deferred: the Cordis plugin model and existing delegation mechanisms provide a substantial starting point, and no demonstrated user requirement currently warrants replacing them.

**Enforce the five priority groups as a fixed backlog.** Rejected: dependencies, evidence and user value can change the best next bounded responsibility.

## Acceptance criteria

Documentation completion means that a fresh agent can find the selected DSH execution foundation, existing delegated-model capabilities, five provisional priorities, candidate upstream sources, expected user outcomes, meaningful completion observations, dependencies, explicit non-goals and unresolved decisions without inferring that unimplemented work already exists.

The proposal remains in `proposed/architecture/` until a future implementation decision earns its own verified state. This change must be limited to the complete English/Chinese/sidecar Agent Note triplet and any minimal necessary discovery link. Bilingual pairing, Note format, links, wrap, budgets and documentation checks must run on the exact proposed revision before merge; unexecuted checks are not PASS.

## Risks

A roadmap can create false completion pressure, reward feature count over coherent user experience, and hide the cost of supporting multiple runtimes. Keeping proposed user outcomes separate from existing package facts limits that risk. Upstream APIs and licenses can change; each later adaptation needs source-pinned review, security assessment and any required notices.

Independent native workers can use different credentials, sandbox rules and working directories. Cross-repository writes, hook enforcement, unattended resumption and protected publication must be qualified separately before increasing delegated authority. The documented Windows pilot is not evidence of these guarantees.
