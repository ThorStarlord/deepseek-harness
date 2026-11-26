# Agent Note: Risk-proportionate product/design review

Status: proposed

English | [中文](2026-11-26-risk-proportionate-product-design-review.zh.md)

## Problem

The fork's prior review process required an independent human product/design disposition for ordinary user-visible changes, even when the behavior was reversible and its claims could be checked directly. External reviewer availability is not reliable for a personal fork, so this rule could leave otherwise well-qualified work indefinitely unintegrated. The process still needs independent scrutiny proportionate to consequence and must preserve human and owner authority for consequential changes.

## Proposal

The [client UI/UX skill](../../../skills/dsh-client-ui-ux/SKILL.md#design-review-escalation) owns a prospective, risk-proportionate product/design review process. Low-risk presentation and local reversible interactions require focused behavior checks and inspection of the assembled application; a separate reviewer is optional. Moderate-risk stateful user-facing behavior, Activity persistence, and explicitly confirmed cross-Session dispatch limited to the user's existing access and target runtime permissions require a separate read-only agent product/design assessment against the exact candidate. A separate technical/security assessment and focused lifecycle checks also apply when persistence, authorization use, or external execution is affected. Direct live-provider evidence is required when an acceptance claim depends on actual provider behavior. High-risk changes retain qualified independent human product/design review, applicable technical/security review, and explicit owner authorization for protected decisions. Mixed or ambiguous changes use the highest credible tier.

An agent assessment identifies its reviewer and model when available, role, exact reviewed SHA, inspected interaction and evidence, findings, disposition, and limitations. Its disposition is labeled as an agent assessment and is never described as human approval. Separate technical/security and product/design assessments use independent read-only contexts. Unavailable evidence leaves the affected claim unqualified. The policy does not change authentication, native provider permissions, security controls, protected transitions, or merge authority.

The proposed process would apply only to review decisions made after the exact policy revision is ratified and integrated. It would not retroactively qualify prior changes or revive the expired Stage 1 exception. The one-time PR #53 exception remains a historical, PR-specific decision and does not set the general rule.

## Alternatives considered

- **Keep human review mandatory for every visible change — rejected.** This preserves independent human judgment but makes routine reversible work depend on reviewer availability that the personal fork cannot reliably provide.
- **Allow agent assessment for every risk tier — rejected.** This would treat AI review as an adequate substitute for human judgment on authentication, permission, security, destructive, and protected changes.
- **Scale review by risk — proposed.** Independent agent assessment would be available for low- and moderate-risk work with exact-commit evidence and focused verification; high-risk work would keep human review and protected owner decisions. Explicitly confirmed operations remain moderate when they preserve the user's existing access and target permissions. This preserves proportionate independent scrutiny without making routine work depend on the upstream roster.

## Acceptance criteria

- The client UI/UX skill classifies mixed and ambiguous changes by the highest credible risk and gives actionable evidence and reviewer requirements for each tier.
- Agent assessments remain separately performed, read-only, exact-commit, explicitly labeled, and distinct from human review and owner authorization.
- Existing authentication, permission, security, protected-transition, merge-authority, and claim-proportionate evidence requirements remain intact.
- The policy applies prospectively only after explicit owner ratification of the exact revision and its integration; it does not retroactively qualify PRs #59 or #61.
- Bilingual Agent Note files and their pairing record pass the repository documentation gates.

## Risks

Agent assessments may miss usability or technical problems that an independent human reviewer would find. Risk classification can also be wrong, especially for mixed or unfamiliar changes; the highest credible tier and high-by-default ambiguity rule are intended to fail conservatively. The owner must ratify the exact final text before it changes the operative review process. Until then, the existing human-review requirement remains in force.
