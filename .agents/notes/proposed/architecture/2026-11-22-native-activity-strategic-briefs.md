# Agent Note: Native Activity strategic briefs

Status: proposed

English | [中文](2026-11-22-native-activity-strategic-briefs.zh.md)

## Problem

Home Activities preserve user-directed work across Sessions, while Sensemaking Skills provide source-grounded strategic reasoning. Without a native connection, users must manually carry repository findings and recommendations between Sessions; building another strategy controller would duplicate the existing Skills and their retrieval practices.

## Proposal

Store each Activity Strategic Brief as an append-only version-1 Activity domain. An explicit `/activity assess` request should load the existing Sensemaking Skills and ask for separate one-shot approval of the exact task and selected Workspaces before the existing coordinator starts one read-only DSH child Session per repository. Those analysis Sessions cannot implement or mutate the repositories. The request should save an agent-authored recommendation with its Activity, originating Session, selected Workspaces, skill digests, source references, and coordinator-reported revisions. The recorder should bind Workspace identity, revision, and observation time to the matching coordinator result in the originating Session, while leaving source content and findings attributed to the Agent. Opening an Activity should show historical briefs without rerunning assessment. The request-scoped tool guard blocks unrelated model tool calls in the requesting Session until the assessment is saved or canceled and its turn ends; configured Agent permissions remain unchanged. Dirty sources are incomplete; `HEAD` identifies only the committed base, and the episode does not snapshot staged or working-tree file contents.

## Alternatives considered

**Store assessments in the Activity or user-annotation record?** Rejected because strategic analysis is agent-authored and source-attributed; it must remain distinct from user intent and user-authored corrections.

**Implement a second native strategic controller?** Rejected because the existing Sensemaking Skills own the analysis method and the existing coordinator owns approved read-only multi-repository access. A second controller would duplicate those responsibilities before an observed limitation warrants it.

**Import Superagent or Dark Factory orchestration?** Deferred because Activity Strategic Briefs are advisory; Ticket or Campaign admission and execution authority are outside this first reversible integration.

**Read repositories through the active Agent's general file tools?** Rejected because those tools do not establish the selected Workspace scope, source revisions, or the coordinator's separate one-shot read approval.

## Migration compatibility

The reference contracts were inspected at Sensemaking Skills `91dfc13bd5cd695d9b94dd54c25664cbefe0317b`, Superagent `6337fc823ce20251c8de8085948165c81aaa701e`, and Dark Factory `60d50c3ee555556223be6be7e26726c7cbef4f6b`. Sensemaking keeps the active agent responsible for strategic judgment and its Skills responsible for method; this integration loads those Skills and uses the existing coordinator without copying its semantic knowledge store or adding an automatic router. Superagent intake deduplicates and routes source Triggers to Evaluations or subscribed Tickets; accepted evaluations establish Ticket mandates and Assignments, whose reports and recovery retain execution ownership. Dark Factory separately preserves authorized Goal revisions, a current Strategic Frontier, explicit Campaign grants, evidence admission, protected integration, and recovery. Stage 2A preserves Activity identity, objective, source-set identity, historical recommendations, and advice-versus-execution separation. It creates no Trigger, Evaluation, Mandate, Ticket, Assignment, Goal revision, Frontier, Grant, Campaign, or integration record; migration of those lifecycle semantics remains deferred.

## Acceptance criteria

- A user explicitly selects a saved Activity and exactly two registered Workspaces before assessment.
- Assessment uses the existing Sensemaking Skills and approved read-only coordinator; unavailable sources remain visibly incomplete.
- Durable episodes retain source identity, DSH-reported revisions, observed working-tree state, and per-repository observation times without copying repository contents or Session transcripts.
- A later Session can inspect prior recommendations and their evidence, while changed or unavailable source state is reported as uncertainty.
- A brief cannot be complete if a selected Workspace is dirty, changed during observation, unavailable, or has unknown source stability. Assessment and reopening do not programmatically start implementation providers, create Goals, Tickets, Campaigns, or change permissions.
- Findings remain agent-authored advice, separate from independent verification and user acceptance.

## Risks

The request-scoped guard blocks unrelated tool calls during the assessment turn but does not change configured permissions or add operating-system read confinement. Coordinator metadata records what DSH reports but does not independently verify repository content, citations, or strategic conclusions. A source change during observation or unknown source stability must keep the episode incomplete. Historical briefs remain available after later recommendations supersede them, and opening an Activity does not establish current applicability.
