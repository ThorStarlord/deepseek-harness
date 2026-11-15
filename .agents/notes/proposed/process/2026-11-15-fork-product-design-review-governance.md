# Agent Note: Fork-specific product/design review governance

Status: proposed

English | [中文](2026-11-15-fork-product-design-review-governance.zh.md)

## Problem

This public personal fork inherits a UI skill whose review trigger and inspection standards remain useful, while its named product/design roster belongs to the upstream project. The skill does not explicitly forbid outside reviewers, but it gives no fork-specific route for selecting them or recording their identity, reviewed revision, findings, and disposition. GitHub lists only the fork owner as a collaborator; the default branch has no protection or review gate. Documentation checks do not verify reviewer qualifications or decisions. The safeguard therefore lacks a reliable route in this fork, and technical mergeability cannot establish that review occurred.

## Proposal

Keep independent human product/design review required for extensive UI work and clearly user-perceivable interaction changes. Let the repository owner designate a qualified reviewer for each qualifying PR, including an external reviewer who is not a repository collaborator. The upstream roster remains a source of possible reviewers, not an exclusive requirement or a standing dependency.

A reviewer has relevant product or design responsibility or demonstrable experience evaluating comparable interactions, did not author or materially implement the change, and makes an independent assessment. The PR records the reviewer's identity, concise qualification basis, any relationship that could affect independence, the reviewed commit SHA, inspected interaction and evidence, findings, date, and final disposition. A formal GitHub review or top-level PR comment is accepted; when neither is available, the PR links the original, verifiable review record and identifies its reviewer.

Use four distinct dispositions: **APPROVE** means no blocking product/design findings at the reviewed revision; **CHANGES REQUESTED** records blockers; **ADVISORY** records nonblocking suggestions and does not satisfy review by itself; **OWNER EXCEPTION** is unavailable under this proposal. Product/design approval does not replace technical validation or grant merge authority. An approval applies only to its recorded SHA, and changed interaction receives review again when a change could alter the assessed result. Adopting this process does not approve a PR already open; every qualifying change needs its own recorded decision.

Scale reviewer effort with the existing UI workflow and [reviewing-ui-design cookbook](../../../../docs/cookbook/reviewing-ui-design.md). If no qualified reviewer is available, leave the PR open and record the external dependency. Agent assessments may support preparation but do not count as independent human approval. Any owner-only or agent-assisted substitute requires a separate policy amendment explicitly ratified by the repository owner before it can apply.

This is a documented human process. Existing documentation gates validate policy and translation files; no mechanical gate verifies reviewer qualifications or disposition. This proposal does not change GitHub permissions, branch protection, or external collaborators.

## Alternatives considered

- **Option A — External qualified reviewer.** Review quality and independence remain high when the reviewer meets the stated criteria. Availability varies, but the reviewer need not join the collaborator list or come from upstream. Recording identity, qualification, SHA, evidence, and disposition makes the decision accountable. It has low infrastructure cost and per-PR coordination cost, so it fits a solo fork with no independent maintainers.
- **Option B — Fork-designated reviewer.** A designated reviewer gives each change a responsible reviewer and improves accountability. A standing pool could improve availability, but finding, qualifying, and maintaining that pool costs effort; it also gives no independence when the author reviews their own work. This fork has no standing independent pool, so case-by-case designation from Option A is more suitable. Owner selection does not establish qualification or independence.
- **Option C — Owner-ratified alternative assessment.** This is immediately available and has the lowest coordination cost, but its review quality and independence are lower because it substitutes owner or agent assessment for an independent human. Explicit owner rationale could make the exception accountable, but it creates self-approval risk and is a poor default for a solo fork. Not enabled by this proposal; it requires a separate explicit owner-ratified policy amendment before use.

## Acceptance criteria

- The UI skill preserves its review trigger, inspection requirements, and impact-scaled effort while naming a fork-specific reviewer route.
- A reviewer outside the upstream roster and collaborator list can provide an accepted review through an identified GitHub account or original verifiable record.
- Each review records qualification basis, independence, reviewed SHA, inspected scope and evidence, findings, date, and final disposition.
- Approval, requested changes, advisory feedback, and owner exception have distinct meanings; silence and mergeability never satisfy review.
- The policy change does not itself approve a pending PR. An unavailable reviewer leaves the PR open; no owner-only or agent-assisted alternative applies without a separate, explicit owner-ratified policy change.
- The policy remains in its existing skill owner; no duplicate rule is added to the cookbook or repository instructions.
- The proposed note has aligned English and Simplified Chinese versions and a current pairing record.

## Risks

- External reviewers may be unavailable, so a PR can remain open. This preserves review quality at the cost of schedule certainty.
- The owner selects reviewers, which can create perceived bias. Recording qualifications, independence, identity, and the reviewer's own disposition makes that choice accountable without treating selection as approval.
- GitHub and documentation checks do not enforce this human process. The owner must inspect the recorded decision before merging; no settings or automated gate are changed by this proposal.
- An owner-only alternative may be desirable during a long reviewer shortage, but allowing it here would weaken the required independent judgment without a separate decision. Keep that option closed until the owner explicitly ratifies a scoped policy amendment.
