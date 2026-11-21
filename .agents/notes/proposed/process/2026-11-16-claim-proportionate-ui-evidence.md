# Agent Note: Claim-proportionate UI evidence

Status: proposed

English | [中文](2026-11-16-claim-proportionate-ui-evidence.zh.md)

## Problem

The current browser-GIF rule requires every product-user-visible GUI change to include a real-server, real-model GIF. That requirement can be unrelated to local presentation or persistence claims, while a GIF alone does not establish behavior, provider integration, or acceptance. Replacing the universal rule without precise evidence criteria could weaken review of live provider behavior or protected interactions.

## Proposal

Adopt a prospective evidence policy for product-user-visible GUI changes across the repository after explicit owner ratification and integration of the exact replacement. Until then, the current requirements remain operative, including for PRs #33 and #34; this proposal cannot qualify them retroactively.

Select evidence by the changed behavior, each acceptance claim, and the highest risk touched by the change. Require focused tests and inspection of the assembled application when UI behavior changes. Use screenshots for static states and video when sequence, timing, or intermediate states matter. A video or screenshot is presentation evidence; it does not replace behavior tests or independent assessment. If live-provider behavior is an acceptance criterion, missing live evidence leaves the pull request unqualified until evidence is obtained or the owner changes the accepted scope.

Local persistence and Activity coordination require focused behavior, restart, unresolved-reference, and recovery evidence where those claims apply, plus inspection of the actual rendered interaction. They do not require a model round solely because they appear in a GUI.

Provider execution, authentication, and external-effect claims require focused deterministic tests, actual rendered interaction, and the separate technical/security and product/design assessments required by the operative review policy. Claim live provider behavior only with direct real-provider evidence when accessible. If a provider cannot be exercised, record that behavior as unverified and do not imply a live result.

Permission, identity, destructive-effect, and other protected requirements remain owned by their existing security and authorization policies. Evidence selection does not change reviewer qualifications, dispositions, native provider controls, or the Stage 1 agent-assisted alternative limited to Issues #17–#30.

For every evidence item, record the reviewed commit, source, modes, and whether it came from a live provider, deterministic test, replay, or static inspection. Separate observed facts from interpretation, state residual uncertainty, and use the stronger requirements when risk or the supporting claim is unclear.

## Alternatives considered

- **Require a real-model GIF for every GUI change.** This keeps one uniform artifact rule and makes interaction sequences visible, but forces provider use for local claims and can imply that a GIF establishes behavior it does not test.
- **Use tests alone for every GUI change.** This avoids recording cost, but does not show the assembled interface or its interaction states and can miss presentation defects.
- **Use static screenshots alone for every GUI change.** This gives reviewers direct rendered evidence for stable states, but cannot show an interaction sequence or timing and does not establish provider behavior.

## Acceptance criteria

- The UI review skill defines the claim and risk matrix, exact rendered-evidence expectations, mixed-risk escalation, and fail-closed treatment of unsupported live claims.
- The GIF skill describes when recording is required and requires the demonstrated commit SHA, serving tree, origin and runtime mode, with secure credential handling, artifact inspection, and truthful live-versus-fixture descriptions.
- The policy leaves current review authority and native authorization safeguards intact, and does not qualify prior pull requests retroactively. PRs #33 and #34 remain subject to their existing qualification requirements, including the exact-tree real-server/real-model GIF, even after this policy is integrated.
- The bilingual Agent Note and documentation checks are complete before the owner ratifies the exact replacement policy.

## Risks

A reviewer may classify a provider or external-effect change as local and select insufficient evidence. The highest-risk change and claim therefore govern, and unclear cases use stronger requirements. Static evidence may omit transient failures or timing; use video when those states matter. Direct evidence may still be incomplete, so missing provider evidence remains explicitly unverified and unresolved acceptance claims remain unqualified.
