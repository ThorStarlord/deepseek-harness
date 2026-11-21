# Agent Note: Claim-proportionate UI evidence

Status: proposed

English | [中文](2026-11-16-claim-proportionate-ui-evidence.zh.md)

## Problem

The current browser-GIF rule requires every product-user-visible GUI change to include a real-server, real-model GIF. That requirement can be unrelated to local presentation or persistence claims, while a GIF alone does not establish behavior, provider integration, or acceptance. Replacing the universal rule without precise evidence criteria could weaken review of live provider behavior or protected interactions.

## Proposal

Adopt a prospective evidence policy for product-user-visible GUI changes across the repository after explicit owner ratification and integration of the exact replacement. Until then, the current requirements remain operative, including for PRs #33 and #34; this proposal cannot qualify them retroactively.

Select evidence for each acceptance claim and its risk; the highest-risk affected claim governs a mixed change. Require focused tests and inspection of the assembled application when UI behavior changes. Use screenshots for static states and video when sequence, timing, or intermediate states matter. Neither replaces behavior tests, required review, or provider evidence. A live model round is not required solely because a change appears in the GUI. If live-provider behavior is an acceptance criterion, missing live evidence leaves the pull request unqualified until the evidence is obtained or the owner changes the accepted scope.

Local persistence and Activity coordination require focused behavior, restart, unresolved-reference, source-attribution, and recovery evidence where those claims apply, plus inspection of the actual rendered interaction. For a record-only external handoff, verify persistence and attribution and confirm that recording does not start external work. These claims do not require a model round unless an acceptance claim depends on provider behavior.

Delegated execution and other external-effect claims require focused tests for explicit user initiation, authorization ownership, provider admission and execution, failure and recovery, source attribution, and the absence of unintended execution. Inspect the assembled interaction and obtain the separate technical/security and product/design assessments required by the operative review policy. Authentication, permissions, identity, destructive effects, and consequential outcome claims retain their stronger owning review and authorization requirements. Claim live provider behavior only with direct real-provider evidence. A provider report is not independent verification or user acceptance; record those dispositions separately with their responsible actor and evidence. If a provider cannot be exercised, label that behavior unverified and do not imply a live result.

Permission, identity, destructive-effect, and other protected requirements remain owned by their existing security and authorization policies. Evidence selection does not authorize a protected change or alter reviewer qualifications, dispositions, native provider controls, or the owner approval required by those policies. The Stage 1 agent-assisted alternative applied only to Issues #17–#30 and expired when Issue #30 integrated; it is unavailable for current and future work.

For every evidence item, record the reviewed commit, application source, relevant modes, and whether it came from a live provider, deterministic test, replay, or static inspection. For provider evidence, name the provider and model and attribute each reported outcome to its source. Separate observation from interpretation and state residual uncertainty. When risk or the claim is unclear, use the stronger applicable requirements. This proposal takes effect only after the owner ratifies the exact replacement and it is integrated; it does not change the prior qualification of PRs #33 or #34.

## Alternatives considered

- **Require a real-model GIF for every GUI change.** This keeps one uniform artifact rule and makes interaction sequences visible, but forces provider use for local claims and can imply that a GIF establishes behavior it does not test.
- **Use tests alone for every GUI change.** This avoids recording cost, but does not show the assembled interface or its interaction states and can miss presentation defects.
- **Use static screenshots alone for every GUI change.** This gives reviewers direct rendered evidence for stable states, but cannot show an interaction sequence or timing and does not establish provider behavior.

## Acceptance criteria

- The UI review skill defines the claim and risk matrix, exact rendered-evidence expectations, mixed-risk escalation, and fail-closed treatment of unsupported live claims.
- The GIF skill describes when recording is useful or required and preserves the demonstrated commit and application source, secure credential handling, artifact inspection, and truthful live-versus-fixture descriptions.
- The policy distinguishes record-only handoffs from execution and provider reports from independent verification or user acceptance. It preserves current human-review and security authority, records the Stage 1 agent-assisted exception as expired, and does not qualify prior pull requests retroactively. PRs #33 and #34 remain subject to their existing qualification requirements, including the exact-tree real-server/real-model GIF, even after this policy is integrated.
- The bilingual Agent Note and documentation checks are complete before the owner ratifies the exact replacement policy.

## Risks

A reviewer may classify a provider or external-effect change as local and select insufficient evidence. The highest-risk change and claim therefore govern, and unclear cases use stronger requirements. Static evidence may omit transient failures or timing; use video when those states matter. Direct evidence may still be incomplete, so missing provider evidence remains explicitly unverified and unresolved acceptance claims remain unqualified.
