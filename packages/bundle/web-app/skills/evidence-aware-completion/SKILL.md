---
name: evidence-aware-completion
description: Use before reporting completed coding or repository work; distinguish observed changes and checks from claims and state remaining limits.
whenToUse: Load when preparing a completion report for engineering work. Do not use for casual conversation or unrelated responses.
user-invocable: false
---

# Report engineering work from available evidence

Use this guidance only when preparing a completion report for coding or repository work. Do not load it for casual conversation or unrelated requests.

Use tool calls and results visible in the current DSH conversation as execution evidence. A command request, an assistant's claim, or a test name is not evidence that the command completed. A successful tool result establishes what that command reported; it does not prove semantic correctness or independent review.

Report each repository separately when work spans repositories. Attribute changes and checks to the repository, branch or committed revision only when that identity was observed. When visible, identify the relevant tool execution or child run; do not invent Session, run, or event identifiers. Treat a live working tree as a live observation, not an immutable snapshot.

Classify verification from its observed result:

- **Passed:** the matching command completed successfully and its output supports the stated result. Mention skipped cases reported by the command.
- **Failed:** the completed check reported a test or validation failure; name the failure and affected check.
- **Skipped:** the check or cases were explicitly skipped; never count them as passing.
- **Blocked:** the environment prevented the check from starting or completing; its outcome is unknown.
- **Not observed:** no matching execution appears in the current Session evidence. Say that you cannot confirm whether it ran elsewhere; do not claim it was never run.
- **Unknown:** output, cancellation, or process state does not establish an outcome.

Do not rerun tests, start another agent, or continue a loop only to make the report look stronger. Complete checks already required by the task or repository policy while the work is active. Otherwise, qualify the result and state the remaining limitation.

## Completion report

Keep the report proportional to the work:

- **Changes:** what changed and where, attributed to each repository.
- **Verification:** the command or evidence source, its observed status, and any skipped cases.
- **Not verified:** checks with no visible execution, without implying that no external run exists.
- **Limits or blockers:** known defects, incomplete context, environmental failures, and outcomes that remain unknown.

Examples:

- A tool result shows `pnpm test` completed successfully and reports 12 passing tests: “`pnpm test` reported 12 passing tests.” Do not expand that into a claim that all behavior is correct.
- No test command/result is visible: “No test execution is visible in this Session context; I cannot confirm whether tests ran elsewhere.”
- Output reports passing tests and skipped cases: report both counts and keep the skipped cases out of the passing total.
- A Windows process or sandbox error prevents a check from starting: mark it blocked and leave its test outcome unknown.
