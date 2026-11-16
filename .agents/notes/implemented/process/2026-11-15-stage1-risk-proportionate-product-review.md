# Agent Note: Stage 1 risk-proportionate product review

Status: implemented

English | [中文](2026-11-15-stage1-risk-proportionate-product-review.zh.md)

## Problem

The repository requires qualified independent human product/design review for clearly user-perceivable interaction changes. The owner-authorized Home Harness Stage 1 backlog has no confirmed independent reviewer available for every integration, while its tickets preserve explicit user intent, existing permissions, and bounded behavior. Requiring a human for every eligible interaction would block the authorized batch even when risk can be assessed from direct interaction evidence and focused validation.

## Decision

For the owner-authorized Home Harness Stage 1 backlog, Issues #17–#30, a separate read-only agent assessment may serve as an owner-authorized alternative to human product/design review for an eligible low- or moderate-risk change. This is an exception to the human-review requirement for that named scope. It is not independent human review, human approval, or an **APPROVE** disposition. It expires when Issue #30 is integrated and does not apply to other work.

The alternative applies only when the assessment verifies that the change stays within an accepted issue; preserves authentication, authorization, repository permissions, and cross-user identity ownership; requires explicit user action for each Activity operation; adds no provider execution, automatic start, resume, unbounded delegation, irreversible or out-of-scope side effect; and preserves existing Session and Activity facts. New durable Activity records qualify only when their storage is safely versioned, write-failure and restart behavior are tested, rollback and retained-record behavior are understood, and limitations such as unavailable edit or delete operations are disclosed. Existing durable records are not migrated, reparented, or reinterpreted; user-authored additive Activity links or annotations preserve their original fields and facts. The change adds no provider, delegated, repository, or other external execution path or side effect, even when the user's request is explicit.

Low risk means descriptive or cosmetic behavior with negligible blast radius and no persistent data or execution. Moderate risk means bounded, user-initiated local behavior or additive Activity-only data in the strict versioned store, without changing authority. High risk includes changes to authentication, authorization, cross-user privacy, existing durable facts, or external permissions; a new provider, delegated, repository, or other external execution path or side effect; automatic or unbounded execution; migration, rewriting, reparenting, or reinterpretation of existing durable records; destructive or irreversible effects; broad assurances about authorization or safety; and consequential claims about external execution, completion, verification, acceptance, or source history. Direct evidence does not by itself lower those risks. An exact statement about what the current Activity action did may be moderate when rendered evidence and focused tests establish that action. Any unresolved or unclassified risk is high.

An assessing agent must not implement or materially shape the change. It reviews the complete issue criteria, exact PR diff and head SHA, direct rendered interaction evidence, focused validation, findings, and remaining uncertainty in a fresh read-only assessment. For each user-visible interaction, the PR includes rendered evidence that covers the actual affected behavior; tests and implementation inspection support that evidence but do not replace it.

The PR records **OWNER-AUTHORIZED AGENT ALTERNATE — ELIGIBLE** or **HUMAN REVIEW REQUIRED**, the assessing agent and model, its separation from implementation, issue and reviewed SHA, risk rationale, inspected interaction and evidence, validation, findings, and residual uncertainty. Under the policy adopted on 2026-11-15, the owner's Stage 1 scope authorization covered an eligible PR without a separate per-ticket approval. An uncertain eligibility decision, missing rendered evidence, unresolved high-impact finding, or high-risk change required a qualified independent human review. If no qualified reviewer was available, the affected PR remained open. The owner extended this Stage 1 alternative to high-risk changes in the [successor Agent Note](../../implemented/process/2026-11-16-stage1-agent-assisted-assurance.md); this note records the original decision adopted on 2026-11-15.

## Alternatives considered

- **Independent human review for every Stage 1 interaction — retained as the high-risk route.** Human review provides independent product/design judgment and remains mandatory for high-risk or uncertain changes. Requiring it for every eligible item would block this bounded, owner-authorized batch when no reviewer is available.
- **Agent assessment treated as human approval — rejected.** A model assessment is not a qualified human review. Recording it as **APPROVE** would misstate who made the judgment and weaken accountability.
- **Unrestricted owner or agent exception — rejected.** A general substitute would make it easier to bypass product review across the repository. The adopted alternative is limited to Issues #17–#30, requires separate assessment and direct evidence, and escalates uncertain or high-risk cases to a human.

## Consequences

The scoped alternative enables bounded Stage 1 work to proceed without routine per-ticket owner approvals. It has less independent human judgment than a designer or product review and can miss subjective usability concerns. A fresh read-only assessment, explicit risk criteria, direct interaction evidence, focused tests, recorded limitations, and escalation of unresolved or protected decisions reduce that risk without claiming equivalence to human review.

The original alternative changed no authentication, permissions, provider authority, or issue acceptance criteria. It did not authorize execution or begin Stage 2 or Stage 3. Under that original decision, high-risk work remained dependent on a qualified human reviewer; the successor note records the owner's ratified extension for Issues #17–#30.

## Verification

The UI skill defines eligibility, assessment independence, required PR evidence, dispositions, scope, and expiration. The owner verifies those records for each PR using the alternative. Documentation gates verify the skill and bilingual note format; no mechanical gate determines risk eligibility or validates an agent assessment.
