# Agent Note: Stage 1 agent-assisted assurance

Status: implemented

English | [中文](2026-11-16-stage1-agent-assisted-assurance.zh.md)

## Problem

The existing Stage 1 alternative permits a separate agent assessment only for low- and moderate-risk changes, while approved tickets include bounded native-agent execution and consequential execution reporting. The earlier rule makes those high-risk tickets depend on human product/design review even when the owner has authorized the batch and agent assessments plus behavioral evidence can qualify the work.

## Decision

The owner ratified a policy amendment for approved Home Harness Stage 1 Issues #17–#30. The integrated UI skill permits documented independent agent-assisted assessment instead of mandatory human product/design review when the required risk-proportionate assessments and behavioral evidence are complete. The exception applies prospectively from policy integration, expires when Issue #30 is integrated, does not change issue acceptance criteria, and does not authorize work outside the batch. This amendment updates the high-risk route in the [November 15 decision](2026-11-15-stage1-risk-proportionate-product-review.md), which retains the original decision and alternatives.

Low- and moderate-risk changes retain a separate read-only assessment by an agent that did not implement or materially shape the change, plus focused behavior, persistence, restart, and rendered-interaction evidence as applicable. High-risk changes require separate read-only technical/security and product/design assessments by agents that did not implement or materially shape the change; use distinct agents and contexts when available. Assessments identify the issue, exact reviewed commit, agent, model, role, risk rationale, inspected behavior, evidence, validation, findings, and uncertainty.

High-risk evidence examines explicit user authorization for each provider action in the current interaction, provider admission and execution boundaries, unchanged authentication and permissions, errors and recovery, outcome attribution, recorded source fields, and the absence of unintended execution. Opening, reopening, or restarting an Activity never starts, resumes, or rearms delegation or Goal work. Outcome corrections and annotations do not rewrite provider reports, native records, their source fields, or observation times. Use real-provider evidence when available. Deterministic provider-backed tests may cover otherwise inaccessible provider paths, but they establish only the behavior exercised and do not support a claim of live integration.

The alternative does not authorize changes to authentication or authorization policy, ambient or repository permissions, cross-user ownership, credential disclosure, native Codex or Claude Code safety controls, destructive effects, or unbounded execution. If a ticket requires a protected change, stop before that behavior, implement the safe bounded portion, and obtain explicit repository-owner authorization before adding the protected behavior. Stage 1 review authorization does not grant that authority. Missing acceptance evidence or an unresolved blocking finding leaves the change unqualified and unmerged.

Use the assurance claim: “Implemented and qualified through documented technical verification and independent agent-assisted assessment, with limitations and uncertainty explicitly reported.” Agent assessment is not human review or approval and is never recorded as **APPROVE**.

## Alternatives considered

- **Keep every high-risk Stage 1 change on the human-review path.** This preserves independent human product judgment but can block the approved batch where a qualified reviewer is unavailable despite stronger separate agent assessments and direct behavioral evidence.
- **Treat an agent assessment as human approval.** This misstates who made the judgment and weakens accountability; the adopted assurance claim identifies agent-assisted assessment explicitly.
- **Apply the exception across the repository.** A general waiver would weaken unrelated review requirements; the amendment remains limited to Issues #17–#30 and expires after Issue #30 is integrated.

## Verification

The UI skill defines the Stage 1 scope, risk categories, assessment roles, evidence, exclusions, disposition, and expiration. Each eligible assessment record names the reviewers, models, roles, reviewed issue and commit, evidence, validation, findings, limitations, and uncertainty. Focused behavioral checks and direct rendered evidence are required where applicable. Authentication, authorization, permissions, credential handling, provider controls, and execution scope remain protected. Documentation checks validate note format, links, and the bilingual pair; no automated gate determines assessment quality.

## Consequences

The policy enables the approved Stage 1 batch to proceed with documented agent-assisted assessments when a qualified human reviewer is unavailable. Agent assessments provide less human product judgment and can miss subjective usability or security concerns. Separate review roles, direct evidence, focused behavioral tests, explicit limitations, and escalation before protected changes reduce that risk without claiming equivalence to human review.
