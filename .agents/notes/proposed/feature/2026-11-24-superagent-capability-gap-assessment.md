# Agent Note: Superagent capability gap assessment

Status: proposed

English | [中文](2026-11-24-superagent-capability-gap-assessment.zh.md)

## Problem

The owner's current product objective is a personal DeepSeek Superagent that coordinates persistent coding Sessions across repositories. DeepSeek Harness currently provides many of the needed execution and persistence primitives, but they have distinct owners and lifecycles. Their presence does not yet give one central Session an integrated way to discover, assign, supervise, and reconcile work across unrelated Sessions.

The existing [modular coding environment roadmap](2026-11-10-modular-coding-environment-roadmap.md) already prioritizes multi-repository orchestration and durable delegated work. This assessment narrows the next responsibility against the more explicit Superagent objective. It is an evidence-based recommendation, not a replacement roadmap or authorization to change provider controls.

## Proposal

Keep the Superagent as the product and build it by composing DSH's existing Session, Activity, Workspace, query, and execution services. Use Sensemaking Skills for reasoning method, not as a second runtime controller. Keep Codex and Claude Code in their native runtimes. Keep Dark Factory independent.

The intended coordinator is an ordinary DSH root Session. An Activity supplies durable user intent and selected project context. A Workspace identifies a registered repository context. A Session remains the owner of its own history, Agent, and runtime permissions. A responsibility is the missing relation: it binds a bounded user-approved task to its Activity, selected repository context, and one or more specific execution Sessions, then preserves attributed progress and outcomes for later reentry.

### Current capability map

The classifications below describe canonical master and the documented execution evidence. “Integrated” does not mean that the complete Superagent experience has been demonstrated.

| Capability | Current status | Product limit |
|---|---|---|
| Activities and associations | Integrated; durable Activities can link selected Workspaces and Sessions, retain annotations, delegation reports, handoffs, reviews, and strategic episodes. | Links do not discover or supervise Sessions, and Activity scope does not grant access. See the [Activity contract](../../../../packages/home/activity/README.md). |
| Session access | Integrated lower-level capability; the Session Controller supports list, search, history, state, create, and prompt operations for the Web client. | The API is a Client operation with access control, not a model-facing cross-root coordinator. Session Query's optional model tools are read-only and restrict cross-session access to an exact working-directory match. See [Session Controller](../../../../packages/api/session-controller/README.md) and [Session Query tools](../../../../packages/experimental/tool-session-query/README.md). |
| DSH-native subagents | Integrated; one root and its continuable descendants can be discovered, messaged, interrupted, and cold-resumed. | These operations remain within one subagent tree. They do not coordinate unrelated root Sessions. See [Subagent](../../../../packages/subagent/subagent/README.md). |
| Teams, workflows, Goals, and jobs | Integrated primitives with separate lifetimes. Teams coordinate a shared task board within a subagent tree; workflows fan out a foreground script; Goals retain one Session objective; jobs belong to a serving Session. | None supplies a durable, Activity-scoped assignment lifecycle across independent root Sessions. See [Team](../../../../packages/team/agent-team/README.md), [Workflow](../../../../packages/workflow/workflow/README.md), [Goal](../../../../packages/goal/goal/README.md), and [Jobs](../../../../packages/jobs/jobs/README.md). |
| Cross-repository analysis | Integrated read-only operation for exactly two selected, registered local Git Workspaces, with explicit approval and per-repository child Sessions. | It does not coordinate writes or provide one three-repository responsibility workflow. See [multi-repository analysis](../../../../packages/workspace/tool-multi-repository/README.md). |
| Codex and Claude Code | Integrated one-shot delegation with native authentication and permission handling. | Their current DSH adapters do not expose continuation, resume, transcript inspection, or rollback. See the [fork foundation](../../../../docs/fork-foundation.md). |
| Strategic reasoning | Sensemaking Skills are loaded by the explicit Activity assessment flow, which stores attributed advisory briefs. | Deterministic capability evidence does not establish live strategic effectiveness. A recommendation is not an assignment or execution authority. See the [Stage 2A proposal](../architecture/2026-11-22-native-activity-strategic-briefs.md). |
| Strategic reentry | Separate Stage 2B implementation is under review outside canonical master. | It concerns reconsidering a saved brief; it is not a prerequisite for discovering or coordinating Sessions from canonical master. |

The relation “an Activity groups Sessions” is established only as a saved association. The Activity contract does not promise that the coordinator can inspect or control those Sessions. The relation “Session Controller can prompt a Session” is established for its authenticated Client route; that does not establish model authority to prompt an unrelated root Session. These distinctions are the basis for the recommended gap, rather than a claim that DSH lacks Session or delegation capabilities.

### User-workflow assessment

| Scenario | What is available now | What remains missing |
|---|---|---|
| Compare Auteur, Sensemaking Skills, and DSH | A user can register local Workspaces and explicitly approve read-only pair analysis. The existing operation covers two repositories at a time. | One source-attributed assessment across all three repositories, with currentness and cross-repository opportunities reconciled into a warranted next responsibility. |
| Coordinate concurrent implementation | DSH can start subagents and use Team or Workflow inside a root tree; separate Sessions can be managed through the Web client. | A central model-facing assignment path, safe selection of existing root Sessions, durable responsibility identity, progress observation, dependency handling, and attributed reconciliation across them. |
| Recover project status after restart | Activity, Session, Workspace, delegation, and strategic records persist. The user can open Sessions and inspect their histories. | One Activity-level view that distinguishes active, reported, blocked, uncertain, verified, and accepted work across its Sessions without manually reconstructing each conversation. |
| Continue existing Sessions | The Web Session Controller can list, search, open, and prompt ordinary DSH Sessions. DSH subagent controls can continue eligible members of one tree. | A central coordinator cannot safely identify and continue the right unrelated root Session from the model, and native Codex or Claude Code Sessions cannot be represented as resumable DSH Sessions. |

For the named Auteur scenario, this assessment used the public main-branch README because the local Auteur checkout contains unrelated untracked artifacts; that working tree was left untouched. Auteur describes a local-first author-agent for long-form narrative work; Sensemaking Skills supplies source-grounded repository reasoning; DSH supplies execution and persistence. This assessment did not execute a live three-repository analysis.

### RELATE assessment and bottleneck

Claim: “In the canonical DSH product composition, a central model can discover and assign work to unrelated root Sessions across selected repositories.” Scope: current model-facing tools and the Session, Activity, Workspace, and subagent contracts in canonical master.

The declared contracts provide Activity associations, Session Controller operations, one-tree subagent controls, and a two-Workspace read-only analysis tool. The implementation exposes the Session Controller's cross-Session prompt path through the authenticated Client API; the model-facing Session Query package is optional, read-only, and working-directory scoped. No current source or integrated use establishes an Activity-linked responsibility that coordinates unrelated root Sessions. The gap is in the integrated coordination product, not in basic Session persistence, Workspace identity, or agent execution.

The first bottleneck is therefore the missing durable responsibility-to-execution relationship and a principal-preserving central interaction. Session discoverability and progress observation are the first implementation steps inside that vertical. Provider continuation is a later, provider-specific limitation, not a reason to invent a shared Session lifecycle.

### Recommended first vertical

Build **Activity-scoped DSH Session responsibility coordination** from canonical master. The coordinator will use one explicitly selected Activity and an explicitly selected set of registered Workspaces and associated Sessions. It will recover current Session facts, recommend one bounded responsibility, obtain user confirmation for the exact target Session and task, use the target's existing DSH Session route, observe the result, and retain an attributed record that another coordinator Session can recover.

The first vertical should coordinate DSH-native root Sessions only. Its cross-root inspection and dispatch must be Client-mediated: the model proposes a target and task, the Client displays the exact request for explicit user confirmation, and the authenticated Client Remote calls the existing API Gateway route with the user's principal and target resource checks. Any returned Session facts injected into the coordinator must be source-attributed and recorded in its Session history. Do not call a Host service directly from a model tool, synthesize the owner principal, or inherit the coordinator's permissions into the target Session. Preserve each target Session's preset, writer ownership, and configured execution permissions. Do not create a Session, delegate to an external provider, or retry an uncertain prompt automatically. If this confirmed Client round trip cannot be implemented under the existing principal and resource policies, stop the first vertical at read-only discovery and proposal; do not claim cross-root assignment.

Persist a stable responsibility identity and append-only lifecycle facts under the Activity. Each fact should identify the originating coordinator Session, approved Workspace and target Session, request and provider source, observed status or report, evidence sequence or source reference, and uncertainty. Keep the implementation-specific storage choice open until the Activity delegation and handoff contracts are compared against this exact lifecycle; add a separate versioned domain only if those contracts cannot represent it without conflating one-shot reports with continuing root Sessions.

The first release should support observation and continuation of selected DSH root Sessions across at least two repositories, with explicit repository identity and currentness. It should establish the three-repository Auteur, Sensemaking Skills, and DSH scenario as the qualification demonstration when each selected repository is available and authorized. Concurrent assignments may target separate Sessions only when repository/worktree ownership prevents conflicting writes.

### Stage 2B and authority

Stage 2B's strategic reentry implementation remains a separate unmerged responsibility. The first coordination vertical can be developed from canonical master without copying or depending on its branch. If Stage 2B later integrates, the coordinator may retrieve its advisory decisions as evidence; it must still decide whether they remain relevant.

This recommendation does not authorize automatic dispatch, permission changes, repository mutation, integration, or acceptance. The user must approve each task sent to another Session. Provider reports remain distinct from verification and user acceptance. User-visible implementation remains subject to the operative product/design review policy.

### Superagent Prototype reuse assessment

The [DSH Superagent Prototype](https://github.com/ThorStarlord/dsh-superagent-prototype/tree/6337fc823ce20251c8de8085948165c81aaa701e) already implements a central Session, durable Tickets and Assignments, worker status reports, restart recovery, event intake, notices, and a management panel. Its bundle targets one configured GitHub repository, declares DSH `^0.2.1-alpha.2` and Cordis `4.0.5-alpha.1`, creates its own worker Sessions, and includes shell access in its worker preset. Its `ready` report can end a prototype Ticket. Those lifecycles and permissions cannot be substituted for the selected DSH Activity, arbitrary existing root Sessions, authenticated Client dispatch, or the target Session's own authorization.

Reuse the worker-report concept at the DSH ownership layer. The Activity responsibility ledger remains the sole assignment identity and final outcome record. A target root Session may append a bounded progress, waiting, review-ready, blocked, or failed self-report only for its exact admitted or unresolved assignment. The report cites its target `tool/call` event and lives in a separate versioned sidecar, so strict responsibility version 1 facts do not change. DSH does not infer completion, verification, acceptance, scheduling, or a notification from that report. No prototype code or package dependency is copied; the prototype is MIT-licensed and the inspected source revision is retained in this record with its source and revision.

This adaptation supplies only target-reported interim progress. Prototype-wide intake, Ticket admission, worker creation, concurrency scheduling, background-job monitoring, attention routing, recovery controller, and management panel remain unintegrated. The full bundle's compatibility and safety are not qualified by this targeted use. The exact DSH behavior change is a follow-up stacked on the cross-Session coordination PR; integration still requires that PR's own gates and the operative human product/design review.

## Alternatives considered

**Session-centric coordination alone** would reuse Session identity and continuation controls, but it would leave user intent and cross-project context scattered across conversations. Sessions should remain execution owners, not replace the Activity's durable purpose.

**Activity as an execution controller** would make the Activity the owner of process and provider lifetimes. The current Activity contract deliberately stores intent and attributed records without scheduling or granting permission; turning it into a controller would combine responsibilities that have different failure and authorization rules.

**Team or Workflow as the central coordinator** would reuse useful fan-out machinery, but both operate within one caller-owned tree and neither creates durable responsibility state across unrelated root Sessions. They remain appropriate execution primitives inside a selected responsibility.

**Import the DSH Superagent Prototype or Dark Factory** would add a second intake or mission authority model before the gap is proven to need one. The prototype is a research reference, not the product. Dark Factory remains an independent owner of its own mission state and protected transitions. Reuse concepts such as stable assignment identity and operator handoff only when a DSH contract needs them; do not port either system wholesale. See [the fork foundation](../../../../docs/fork-foundation.md).

**Incremental composition** is preferred because it uses DSH's existing owners for Activity intent, Workspace identity, Session execution, query, and provider controls, while adding only the missing durable responsibility relationship and central interaction.

## Acceptance criteria

- A central DSH Session can select one Activity and explicitly identify at least two registered repository Workspaces and their relevant DSH Sessions.
- The coordinator can inspect authorized Session status and source-attributed recent outcomes without creating or waking unrelated Sessions.
- The coordinator can compare repository context and propose a bounded next responsibility with its evidence, alternatives, uncertainty, and repository scope.
- No task is sent until the user confirms the exact responsibility and target Session; an Activity association or recommendation alone grants no execution authority.
- Cross-root status and prompt operations run through a Client-mediated, authenticated API Gateway request that preserves the user's principal and target-resource checks. The model cannot call Host Session Controller methods directly or gain the owner's identity through tool composition.
- A confirmed task reaches the selected ordinary DSH Session through its access-controlled prompt path and retains that Session's native identity, preset, writer ownership, and permissions. Any Session facts returned to the coordinator are source-attributed and reconstructible from its log.
- An Activity retains a stable responsibility identity and append-only status and result facts that another Session can recover after restart without reissuing the task.
- Unknown delivery or persistence outcomes remain uncertain and do not trigger automatic retries. Provider reports remain distinct from verified outcomes and user acceptance.
- The assembled application demonstrates the selected Activity, repository and Session scope, confirmation, progress or failure, attributed result, and later-Session recovery. The three-repository scenario is exercised when all sources are accessible and authorized.
- The first vertical does not resume external Codex or Claude Code Sessions, create Campaigns or prototype Tickets, change protected policy, merge other repositories, or claim improved strategic judgment without comparative evidence.

## Risks

- A model-facing route to another root Session could bypass Client access checks if it calls Host services directly; the implementation must preserve the authenticated principal and target-resource authorization.
- A durable status can become stale while a target Session is active. The coordinator must show observation time and source sequence and distinguish unknown from settled outcomes.
- Two Sessions can mutate the same repository or branch. The initial workflow must require explicit worktree ownership or serialize conflicting assignments.
- The existing read-only repository tool observes live working trees rather than immutable snapshots. Source changes during analysis must remain visible as uncertainty.
- Codex and Claude Code retain their native Session and permission semantics. Excluding cross-runtime continuation from the first vertical limits scope but leaves a real future product gap.
- Independent human product/design review remains required for user-visible changes under current policy; AI assessments do not replace it.
- Stage 2B, Issue #55, and Dark Factory governance remain separate. This assessment makes no decision about them.
