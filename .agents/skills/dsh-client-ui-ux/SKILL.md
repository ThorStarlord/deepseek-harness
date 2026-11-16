---
name: dsh-client-ui-ux
description: "Design and review DSH user-visible UI: alignment, spacing, icons, visual foundation, geometry and interaction. Use before UI changes in client, experimental and app packages; verify affected rendered results before handoff."
---

# DeepSeek Harness UI development

Use this skill as the entry point for UI design and review. It owns the workflow, visual foundation, geometry and interaction guidance; alignment, spacing and icon details live in its references below. Load only the references relevant to the task; examples explain judgment, not coverage.

<a id="required-review-loop"></a>
## UI change workflow

Use applicable design rules for UI changes, including visible loading, error, disabled, expanded and focus states. Choose effort by impact and regression risk; ordinary development does not require a full design audit.

| Change | Required inspection | Additional records |
|---|---|---|
| Local copy, icon reuse, color or spacing | Inspect the actual page, affected neighbors and relevant states; run applicable tests. Apply the minimum checks below. | Briefly report results and material gaps. No separate plan, axis drawing, scene inventory, source snapshot or screenshot report is required by default. |
| Page layout, shared components or global styles | Identify affected relationships and consumers; inspect distinct affected layout, content and state variants in assembled pages. Reuse evidence only for justified equivalents. | Briefly state scope. Preserve the starting version and comparable images when requested or needed to explain broad changes or assess regression risk. |
| Explicit comprehensive review | Cover the agreed regions and relevant states; distinguish inspected results, defects and uninspected scope. | Use the [review cookbook](../../../docs/cookbook/reviewing-ui-design.md) for coverage records, findings and supporting evidence. A comparison request alone does not require a product-wide audit. |

### Minimum checks for affected UI

These checks apply even to small changes; optional documentation does not make inspection optional. Open the actual page and inspect the changed element with its directly affected neighbors, rather than judging CSS or an isolated component alone.

- **Color or opacity:** inspect light and dark themes, including affected foreground/background and state combinations.
- **Layout, spacing, typography or sizing:** inspect a constrained container and long or wrapping content; check both sides of a changed breakpoint, alignment, clipping and access to actions.
- **Interaction:** exercise the changed path and affected focus, disabled, loading, error, expanded and overlapping states. Check only states the change can affect, not every possible combination.
- **Shared components or global styles:** trace affected consumers and inspect distinct assembled layouts and states; one isolated example cannot establish coverage.

If a required scene is unavailable, state what was not checked, why and how it can be verified; a labeled production-component fixture can provide partial evidence, not an actual-page pass. Do not claim verification complete while required checks remain missing. Run the original applicable tests; source inspection and passing tests alone do not establish the rendered result.

Read unchanged owners once; consult examples for uncertain judgments. Inspect relevant states and actual usage sizes, not a fixed screenshot count or every width × theme × state combination. Batch related edits and reuse a current application instance and valid evidence. Documentation-only changes and refactors with evidence of unchanged rendering need no new UI captures; state that basis.

When a before/after comparison is needed, preserve the actual starting implementation, including uncommitted work, and use comparable capture conditions. Never recreate a missing before image and present it as an original. Protect existing work regardless of whether extra evidence is needed.

Before handoff, review or push, check only new cumulative interactions, missing required checks and invalidated evidence; do not repeat completed verification at each stage. Report results and material gaps accurately. Do not claim full coverage or visual acceptance when required scenes or checks are missing.

These effort levels change only the additional design-review procedure. Existing [client test requirements](../../../packages/client/AGENTS.md) and [GUI PR GIF requirements](../record-browser-gif/SKILL.md#every-gui-pull-request-includes-a-gif) still apply. Designer/product approval remains required when its trigger is met, except for a change explicitly eligible under the owner-authorized [Stage 1 alternative](#owner-authorized-stage-1-agent-assisted-assessment).

## Select the rule owners

For layout changes, read the alignment and spacing references. Read the icon reference when selecting, drawing or reviewing artwork, or when adding, changing or reviewing icon buttons, icon-only actions or informational icons, including reuse without artwork changes. Other tasks use the relevant sections below. Do not load all references by default. Existing responsive and official-artwork skills retain their scopes; numeric scales stay with their implementation owners.

| Decision needed before implementation | Section or reference |
|---|---|
| Shared axes, text starts, centering, tree indentation, complete icon boxes | [Alignment](references/alignment.md) |
| Semantic groups, inner/outer gaps, repeated rhythm, section separation | [Spacing and grouping](references/spacing.md) |
| Interface icon selection and artwork; icon buttons and icon-only actions, tooltips, informational hover content, accessible labels and focus | [Icons](references/icons.md) |
| Color, typography and existing treatments | [Visual foundation](#visual-foundation); [Web styling](../../../docs/web-styling.md) owns tokens/materials |
| Component geometry, nested contours and state fills | [Geometry decisions](#component-geometry); [radius standard](../../../docs/ui-radius.md) owns values and exceptions |
| Feedback lifetime, loading, overlays, scrolling and platform clearance | [Interaction and feedback](#interaction-and-feedback); [error handling](../dsh-error-handling/SKILL.md) owns failure guarantees |
| Responsive layout rules, mobile-specific interactions, and truncation/ellipsis rules for components like text and buttons | [Responsive UI](../dsh-responsive-ui/SKILL.md) |
| Official plugin artwork and feature previews | [Official artwork](../dsh-official-plugin-artwork/SKILL.md) |
| Copy, locale ownership and component semantics | [Prose standard](../dsh-prose-standard/SKILL.md), [locale ownership](../../notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md), [primitives catalog](../../../packages/client/ui-primitives/README.md#component-catalog) |
| Density, information hierarchy, combined control states and component choice | [Principle reference](../../../docs/ui-design-review-cases.md#density) sections 3–6 |

## Reuse before adding

Extend existing components, containers and interactions when the capability fits. Register right-sidebar content through a slot in the existing sidebar; do not create a separate sidebar. Follow [icon reuse](references/icons.md#reuse-existing-icons-first). Before restructuring, read [client instructions](../../../packages/client/AGENTS.md) and [client defensive patterns](../../../docs/defensive-patterns/client-components.md) for component/state ownership and layering.

## Visual foundation

- Reuse tokens, values and complete treatments from the target page or nearest established sibling before adding literals; Plugins is the usual full-page reference.
- Verify colors in light and dark themes; keep ink/background pairs readable, especially dimmed text.
- Feature CSS you add or change uses **font weight ≤500**; emphasize with size or ink. ui-theme markdown typography tokens are the exception.
- Use theme typography roles, then the page's scale, then a comparable page's size/spacing ratios. Do not invent a size for a single element. Peers share sizes; keep the scale small (13px is the established row/detail size).
- Apply [alignment](references/alignment.md) and the [same-foreground rule](references/icons.md#placement-and-use) to icon/text relationships, including value chevrons and search prompts.

## Component geometry

Choose component role and size variant, then its container relationship. Compare height, radius, curve, inset and material together; equal radii alone do not establish coherence, and wrapping/expansion alone does not justify larger radii. [Radius standards](../../../docs/ui-radius.md#radius-scale) own values and exceptions.

- **Inset:** coordinate inner/outer curves and inset. Radius subtraction is exact for concentric circular arcs; for superellipses, subtraction is only a nominal sizing rule, so inspect diagonal whitespace as well as side gaps.
- **Flush or adjoining:** the enclosure owns exposed corners; internal joins stay square. Hover fills and pseudo-elements follow that contour without clipping menus or focus.
- **Independent child card/group:** use its own role/size tier, not the dialog radius or subtraction of all parent padding.
- **Circles/capsules:** preserve shape, including avatar container and image, using the theme's round-curve exception; ordinary controls use the shared curve.

Keep fills, strokes and overlays geometrically stable across hover, pressed, selected, loading and disabled states. Reuse [card/elevation materials](../../../docs/ui-radius.md#settings-cards): shadows already include neutral hairlines; retain semantic state-colored borders without doubling neutral edges.

Compare related controls, including small selection controls, at actual size in affected themes/states and relevant long-label/narrow layouts. Static checks reject unsupported declarations; rendered comparison judges fit. Consult [geometry cases](../../../docs/ui-design-review-cases.md#geometry) when needed. Apply to scoped changes, not bulk restyling.

## Interaction and feedback

### Feedback surfaces

Follow [error handling](../dsh-error-handling/SKILL.md#localized-actionable-visible-reports). Choose feedback by message lifetime:

- Transient success/failure uses the app-wide Toast, with state and rendering in a host that survives the reporting panel/tab, such as a `shell.overlay` entry. A deletion may close its source panel; a Toast owned by that panel would disappear with it. Do not toast pending states.
- Failed operations retain visible data; failed deletion keeps the row.
- Surface-owned failures use in-place notices: query failure with Retry or field validation. Keep a compact notice beside populated content; only empty panels center a full error state.
- Use short plain-language errors, preferably one sentence, without internal jargon except necessary diagnostic codes. Chinese notices of at most two sentences omit the trailing 句号（。）. Reserve space or overlay notices so neighbors do not shift.

### Loading states

Lists use skeletons; other page-level loads center a bare spinner. Keep one loading treatment per page/component, including concurrent regions. Add loading text only when context requires it.

### Overlays and menus

Before merge, verify every menu, popover and tooltip closes on outside click (and Escape when focusable), fits the viewport with an edge margin, and escapes ancestor clipping, containing blocks and neighbor coverage, using a portal to body when needed. Flip only into a side that fits; never oscillate when neither fits.

Use shared scrollbar styles and a small inset; bars must stay inside containers without being clipped by rounded corners or edges.

### Platform window adaptation

New headers/pages account for macOS and Windows chrome. Menu, Modal and overlay primitives consume `--dsh-frame-top-clearance`; fix local macOS insets with scoped `[data-platform='darwin']` overrides and stylesheet assertions, not global-variable changes. Review the total clearance + page inset.

## Check the rules together

Inspect the composition, then affected internal/cross-group relationships, distant peers and expanded content. Match both endpoints of axes; compare complete icon boxes before optical adjustments. Preserve popup/focus visibility, field feedback, narrow-layout actions and drafts. Check affected theme materials/platform backdrops. Full-interface claims cover all regions; fixtures/crops establish only what they render.

## Maintain one owner per rule

Update the owning section or reference within this skill; do not expose its design specialties as separate skills. Keep examples in the [case reference](../../../docs/ui-design-review-cases.md); AGENTS and PR workflows link here instead of duplicating rules.

Rule changes state applicability, decisions, exceptions and observable verification; update a distinguishing case and remove superseded statements elsewhere. Declare migration versus future-edit scope without implying existing UI conforms. Automate only mechanically decidable checks. Local review tools consume repository rules and retain source/rule revisions rather than maintaining another standards copy.

## Design review escalation

A PR with extensive UI changes, or any clearly user-perceivable change to UI or interaction, must receive an independent review from a qualified human designer or product reviewer, except for an eligible change using the owner-authorized Stage 1 alternative below. Apply the existing inspection and evidence requirements at a level appropriate to the change's impact and risk; product/design review does not replace technical validation.

### Select a reviewer for this fork

The repository owner may designate a reviewer for each qualifying PR. Reviewers may come from outside the upstream design/product roster and need not be repository collaborators. A reviewer must have relevant product or design responsibility or demonstrable experience evaluating comparable interactions, must not author or materially implement the change, and must make an independent assessment. Record the reviewer's GitHub identity, concise qualification basis, and any relationship that could affect independence in the PR.

### Record the review

A reviewer may submit a formal GitHub review or a top-level PR comment. If neither channel is available, link the original, verifiable review record from the PR and identify its reviewer. The record includes reviewer identity, reviewed commit SHA, inspected interaction and evidence, findings, date, and one disposition:

- **APPROVE:** the reviewed revision has no blocking product/design findings. This disposition covers product/design only; technical validation and merge authority remain separate.
- **CHANGES REQUESTED:** the findings block completion until they are addressed and a final disposition is recorded against the resulting revision.
- **ADVISORY:** suggestions are nonblocking. Advisory feedback alone does not satisfy the required review; the reviewer must separately approve the reviewed revision.
- **OWNER EXCEPTION:** this process grants no owner-only substitute. A substitute or exception requires a separate policy amendment explicitly ratified by the repository owner before it can apply.

An approval applies only to its reviewed commit. Reassess the affected interaction when a later change can alter the reviewed result. Adopting this process does not approve an open PR; each qualifying change still needs its own substantive disposition. Silence, technical mergeability, an unanswered request, or an agent's assessment does not satisfy the human-review requirement. An agent assessment is not independent human approval and may substitute only through the explicit Stage 1 alternative below.

### If no reviewer is available

Seek another qualified reviewer outside the upstream roster. If none is available, keep the PR open and record the external dependency, except where the scoped Stage 1 alternative below applies.

### Owner-authorized Stage 1 agent-assisted assessment

For the owner-authorized Home Harness Stage 1 batch (Issues #17–#30), documented agent-assisted assessment may qualify an in-scope change without mandatory independent human product/design review. This exception takes effect only when this policy amendment is integrated, applies prospectively, and expires when Issue #30 is integrated. It does not change issue acceptance criteria, authorize out-of-scope work, or retroactively approve an earlier disposition. Other work still follows the independent-human requirement.

The implementation agent did not perform the assessment. Each reviewer agent works read-only in a separate assessment context and receives the complete issue criteria, exact diff and head SHA, rendered interaction evidence, focused validation, findings, and residual uncertainty. Record the reviewer agent's identity, model, assessment role, and separation from implementation; use separate reviewer agents for separate roles when the policy below requires them.

A low-risk change is descriptive or cosmetic, has negligible blast radius, and does not add persistent data or execution. A moderate-risk change adds bounded, user-initiated local behavior or an additive Activity-only record in the strict versioned store, without changing authority. A high-risk change includes authentication, authorization, cross-user privacy, existing durable facts, or external permissions; a provider, delegated, repository, or other external execution path or side effect; automatic or unbounded execution; migration, rewriting, reparenting, or reinterpretation of existing durable records; destructive or irreversible effects; broad assurances about authorization or safety; or consequential claims about external execution, completion, verification, acceptance, or source history. Direct evidence does not by itself lower those risks. An exact statement about what the current Activity action did may be moderate when rendered evidence and focused tests establish that action. Any unclassified or unresolved risk is high.

Low- and moderate-risk changes require one separate read-only assessment and focused behavioral validation. The assessment confirms accepted issue scope, explicit user initiation of each Activity operation, unchanged authentication, authorization, permissions, and identity ownership, and preservation of existing Session and Activity facts. Persistent additions are safely versioned and have focused write-failure, restart, rollback, and retained-record evidence; report limitations such as unavailable edit or delete operations. Inspect the actual rendered interaction and relevant states when the change is user-visible, and cover errors and source fields or observation times when affected.

A high-risk Stage 1 change requires two separately performed read-only assessments by agents that did not implement or materially shape it: one technical/security assessment and one product/design assessment. Use distinct agents and contexts when available. The assessments verify accepted issue scope and exact reviewed SHA; explicit user initiation of each provider action in the current interaction; unchanged native provider authorization; provider admission and execution boundaries; error and recovery behavior; preserved source fields and observation times; and absence of unintended execution. Opening, reopening, or restarting an Activity must not start, resume, or rearm delegation or Goal work. Corrections and annotations must not rewrite provider reports, native records, their source fields, or observation times. Direct rendered interaction evidence and focused behavioral validation cover applicable acceptance criteria and affected states. Use real-provider evidence when available. For an inaccessible provider path, deterministic provider-backed tests may establish only the behavior they exercise; report live behavior as unverified and never describe a fake provider as live integration.

The Stage 1 alternative does not authorize changes to authentication or authorization policy, ambient or repository permissions, cross-user ownership, credential disclosure, native Codex or Claude Code safety controls, destructive effects, or unbounded execution. If a ticket requires a protected change, stop before that behavior and obtain explicit repository-owner authorization; this Stage 1 assessment policy does not grant it. Missing evidence, an unresolved blocking finding, or an unsafe provider boundary means the change is not qualified and remains unmerged; a reviewer disposition cannot replace missing acceptance evidence.

Record **OWNER-AUTHORIZED AGENT ALTERNATE — ELIGIBLE** only when every applicable assessment and acceptance requirement is met. The assurance claim is: “Implemented and qualified through documented technical verification and independent agent-assisted assessment, with limitations and uncertainty explicitly reported.” Agent assessment is not human approval and must never be recorded as **APPROVE** or described as independent human review. The record names each reviewer agent and model, role, issue, reviewed SHA, risk rationale, inspected interaction and evidence, validation, findings, and residual uncertainty. The owner's Stage 1 authorization covers eligible issues without separate per-PR approval. See the [successor Agent Note](../../notes/implemented/process/2026-11-16-stage1-agent-assisted-assurance.md) for the ratified decision and rationale.
