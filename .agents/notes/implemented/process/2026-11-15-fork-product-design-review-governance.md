# Agent Note: Fork-specific product/design review governance

Status: implemented

English | [中文](2026-11-15-fork-product-design-review-governance.zh.md)

## Problem

This public personal fork inherits a UI skill whose review trigger and inspection standards remain useful, while its named product/design roster belongs to the upstream project. The skill does not explicitly forbid outside reviewers, but it gives no fork-specific route for selecting them or recording their identity, reviewed revision, findings, and disposition. GitHub lists only the fork owner as a collaborator; the default branch has no protection or review gate. Documentation checks do not verify reviewer qualifications or decisions. The safeguard therefore lacks a reliable route in this fork, and technical mergeability cannot establish that review occurred.

## Decision

This note preserves the case-by-case independent-human-review process adopted for this fork. The proposed replacement is recorded in the [risk-proportionate product/design review proposal](../../proposed/process/2026-11-26-risk-proportionate-product-design-review.md); the requirements below record the earlier policy and its rationale.

The repository requires independent human product/design review for extensive UI work and clearly user-perceivable interaction changes. Except for the scoped Stage 1 alternative in [the risk-proportionate review decision](2026-11-15-stage1-risk-proportionate-product-review.md), the owner designates a qualified reviewer for each qualifying pull request. Reviewers may come from outside the upstream roster and need not be repository collaborators. Review effort follows the existing UI workflow and [reviewing-ui-design cookbook](../../../../docs/cookbook/reviewing-ui-design.md) and scales with the change's impact and risk.

A reviewer has relevant product or design responsibility or demonstrable experience evaluating comparable interactions, did not author or materially implement the change, and makes an independent assessment. The pull request records the reviewer's identity, concise qualification basis, any relationship that could affect independence, reviewed commit SHA, inspected interaction and evidence, findings, date, and final disposition. A formal GitHub review or top-level pull-request comment is accepted. When neither channel is available, the pull request links the original, verifiable review record and identifies its reviewer.

The four dispositions have separate meanings: **APPROVE** means the reviewed revision has no blocking product/design findings; **CHANGES REQUESTED** records blockers that need correction and a final disposition on the resulting revision; **ADVISORY** records nonblocking suggestions and does not satisfy review by itself; **OWNER EXCEPTION** is not available under this decision. An approval applies to its recorded SHA. A later change that can alter the assessed result receives review again. Product/design approval does not replace technical validation or grant merge authority.

When no qualified reviewer is available, the owner records the external dependency and keeps the pull request open unless the scoped Stage 1 alternative applies. Silence, an unanswered request, technical mergeability, and agent assessment do not satisfy human review. The Stage 1 alternative is not independent human approval. This decision does not approve an already-open pull request; each qualifying change has its own recorded disposition.

## Alternatives considered

- **External qualified reviewer — selected.** An external reviewer preserves independent judgment without requiring upstream participation or collaborator access. Availability varies; recording qualifications, independence, SHA, evidence, findings, and disposition makes the decision accountable with little infrastructure cost.
- **Fork-designated reviewer pool — not adopted.** A standing pool could improve availability and clarify responsibility, but finding and maintaining qualified independent reviewers takes effort. Case-by-case designation provides accountability without requiring a permanent roster; the owner's selection does not establish a reviewer's qualification or independence.
- **Unscoped owner or agent substitute — not adopted.** A general owner-only or agent-only route reduces independent judgment and creates self-approval risk. The separate Stage 1 alternative is limited to the named owner-authorized backlog and eligibility criteria; it is not a general substitute for independent human review.

## Consequences

Qualified independent judgment remains the default while case-by-case reviewer selection fits a personal fork with no standing independent pool. External reviewers may be unavailable, so changes outside the scoped Stage 1 alternative can remain open; this preserves human review at the cost of schedule certainty. Recording qualification, independence, identity, evidence, and the reviewer's own disposition makes case-by-case selection accountable, while the reviewer remains responsible for the assessment.

The process is documented rather than mechanically enforced. It changes no GitHub permissions, branch protection, or collaborator list. The owner checks the review record separately from technical validation before merging. Integrating this policy does not retroactively approve another open pull request.

## Verification

The UI skill is the policy owner and contains the review trigger, reviewer criteria, accepted channels, required evidence, dispositions, unavailable-reviewer path, and scoped Stage 1 alternative. The documentation gates check the skill and bilingual Agent Note format; they do not verify reviewer qualifications or decisions. The owner verifies the human-review record or the alternate assessment and its eligibility evidence in each qualifying pull request before merge.
