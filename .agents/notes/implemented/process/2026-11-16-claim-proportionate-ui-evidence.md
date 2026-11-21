# Agent Note: Claim-proportionate UI evidence

Status: implemented

English | [中文](2026-11-16-claim-proportionate-ui-evidence.zh.md)

## Problem

The former browser-GIF rule required every product-user-visible GUI change to include a real-server, real-model GIF. That requirement can be unrelated to local presentation or persistence claims, while a GIF alone does not establish behavior, provider integration, or acceptance. Replacing the universal rule without precise evidence criteria could weaken review of live provider behavior or protected interactions.

## Decision

The UI review policy selects evidence for each acceptance claim and its risk; the highest-risk affected claim governs a mixed change. UI behavior changes require focused tests and inspection of the assembled application. Static states use screenshots, and sequences, timing, or intermediate states use video when those details matter. Rendered evidence does not replace behavior tests, required review, or provider evidence. A live model round is not required solely because a change appears in the GUI. When an acceptance criterion claims live-provider behavior, direct real-provider evidence is required; without it, the claim remains unqualified.

Local persistence and Activity coordination use focused behavior, restart, unresolved-reference, source-attribution, and recovery evidence where those claims apply, plus inspection of the rendered interaction. A record-only external handoff requires evidence of persistence and attribution and confirmation that recording does not start external work. These claims do not require a model round unless an acceptance claim depends on provider behavior.

Delegated execution and other external-effect claims require focused tests for explicit user initiation, authorization ownership, application handling of provider admission and execution, failure and recovery, source attribution, and absence of unintended execution. Reviewers inspect the assembled interaction and provide the separate technical/security and product/design assessments required by the operative review policy. Authentication, permissions, identity, destructive effects, and consequential outcome claims retain their stronger review and authorization requirements. Direct real-provider evidence is required when an acceptance claim says a provider admitted or executed a request or returned a live result. Deterministic tests establish application handling of an execution path and failures, but not live-provider behavior. A provider report is distinct from independent verification and user acceptance; each disposition names its responsible actor and evidence. When a live-provider criterion cannot be exercised, the claim remains unqualified.

Existing security and authorization policies continue to own permission, identity, destructive-effect, and other protected requirements. Evidence selection does not authorize a protected change or alter reviewer qualifications, dispositions, native provider controls, or required owner approval. The Stage 1 agent-assisted alternative applied only to Issues #17–#30 and expired when Issue #30 integrated; it is unavailable for current and future work.

Each evidence item records the reviewed commit, application source, relevant modes, and whether it came from a live provider, deterministic test, replay, or static inspection. Evidence used to qualify a claim comes from that reviewed commit and identified application source. Mismatched evidence may guide a recheck but cannot qualify the claim; replacement evidence comes from the final reviewed tree. Provider evidence names the provider and model and attributes each reported outcome to its source. Review records distinguish observation from interpretation and state residual uncertainty. When risk or a claim is unclear, the stronger applicable requirements apply. This policy took effect prospectively after owner ratification of the exact proposal and integration of PR #37; it does not change the prior qualification of PRs #33 or #34.

## Alternatives considered

- **Require a real-model GIF for every GUI change.** This keeps one uniform artifact rule and makes interaction sequences visible, but forces provider use for local claims and can imply that a GIF establishes behavior it does not test.
- **Use tests alone for every GUI change.** This avoids recording cost, but does not show the assembled interface or its interaction states and can miss presentation defects.
- **Use static screenshots alone for every GUI change.** This gives reviewers direct rendered evidence for stable states, but cannot show an interaction sequence or timing and does not establish provider behavior.

## Consequences

The policy avoids live provider requests for local presentation or persistence claims while requiring assembled-application inspection, focused tests, and direct live-provider evidence when an acceptance claim depends on actual provider behavior. Static evidence is sufficient only for stable states; video remains necessary when a sequence or transient state matters. Mixed changes use the highest-risk requirement, and ambiguous classifications use stronger requirements. The policy relies on accurate claim classification, and missing evidence for an acceptance criterion leaves that claim unqualified. Provider reports remain distinct from verification and user acceptance.
