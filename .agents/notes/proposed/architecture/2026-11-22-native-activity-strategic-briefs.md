# Agent Note: Native Activity strategic briefs

Status: proposed

English | [中文](2026-11-22-native-activity-strategic-briefs.zh.md)

## Problem

Home Activities preserve user-directed work across Sessions, while Sensemaking Skills provide source-grounded strategic reasoning. Without a native connection, users must manually carry repository findings and recommendations between Sessions; building another strategy controller would duplicate the existing Skills and their retrieval practices.

## Proposal

Store each Activity Strategic Brief as an append-only version-1 Activity domain. An explicit `/activity assess` request should load the existing Sensemaking Skills, use the existing read-only multi-repository coordinator after its separate approval, and save an agent-authored recommendation with its Activity, Session, selected Workspaces, skill digests, source references, and coordinator-reported revisions. The recorder should bind Workspace identity, revision, and observation time to the matching coordinator result in the originating DSH Session, while leaving source content and findings attributed to the Agent. Opening an Activity should show historical briefs without rerunning assessment. The operation should not change the active Agent's tools, provider permissions, or execution configuration.

## Alternatives considered

**Store assessments in the Activity or user-annotation record?** Rejected because strategic analysis is agent-authored and source-attributed; it must remain distinct from user intent and user-authored corrections.

**Implement a second native strategic controller?** Rejected because the existing Sensemaking Skills own the analysis method and the existing coordinator owns approved read-only multi-repository access. A second controller would duplicate those responsibilities before an observed limitation warrants it.

**Import Superagent or Dark Factory orchestration?** Deferred because Activity Strategic Briefs are advisory; Ticket or Campaign admission and execution authority are outside this first reversible integration.

**Read repositories through the active Agent's general file tools?** Rejected because those tools do not establish the selected Workspace scope, source revisions, or the coordinator's separate one-shot read approval.

## Acceptance criteria

- A user explicitly selects a saved Activity and exactly two registered Workspaces before assessment.
- Assessment uses the existing Sensemaking Skills and approved read-only coordinator; unavailable sources remain visibly incomplete.
- Durable episodes retain source identity, DSH-reported revisions, observed working-tree state, and per-repository observation times without copying repository contents or Session transcripts.
- A later Session can inspect prior recommendations and their evidence, while changed or unavailable source state is reported as uncertainty.
- A brief cannot be complete if a selected Workspace is dirty, changed during observation, unavailable, or has unknown source stability. Assessment and reopening do not programmatically start implementation providers, create Goals, Tickets, Campaigns, or change permissions.
- Findings remain agent-authored advice, separate from independent verification and user acceptance.

## Risks

The active Agent retains its existing tool permissions; the assessment instruction does not create a hard execution sandbox. Coordinator metadata records what DSH reports but does not independently verify repository content, citations, or strategic conclusions. A source change during observation or unknown source stability must keep the episode incomplete. Historical briefs remain available after later recommendations supersede them, and opening an Activity does not establish current applicability.
