---
name: test-driven-development
description: Apply a focused red-green-refactor cycle to an implementation or bug-fix task when the user explicitly invokes this Skill; skip work without a useful behavior test.
whenToUse: Load only after the user invokes /test-driven-development. Do not apply to casual, documentation-only, or configuration-only requests.
disable-model-invocation: true
user-invocable: true
---

# Test-driven development in DSH

Use this Skill for one implementation or bug-fix task at a time. The user invoked this workflow; do not turn it into a broader plan or require a test where no useful behavior test fits.

## Workflow

1. Read the repository's `AGENTS.md` and relevant package instructions. Inspect the current changes and existing tests before editing. Preserve unrelated and uncommitted work.
2. **Red:** Add the smallest test for one requested behavior and run it with the repository's test command. Confirm that it fails because the behavior is missing. If it passes, fails for setup or syntax, or cannot run, fix the test or state the limitation; do not force a misleading failure.
3. **Green:** Make the smallest implementation that satisfies the test. Run the focused test and address a failure in the implementation before changing the acceptance test.
4. **Refactor:** Clean up the local change only when the focused test passes, then rerun the affected test. Run adjacent checks required by repository instructions; do not run the entire suite solely because more checks exist.
5. Report the change and the commands actually observed. Distinguish passing, failed, skipped, blocked, and unrun checks. A passing command supports its reported result; it does not establish semantic correctness or independent review.

## Limits

- If the request changes only documentation, configuration, generated output, or another surface with no meaningful behavior test, explain why this workflow does not fit and use the relevant repository check instead.
- Follow the selected profile's available tools, approval rules, and sandbox. Do not change permission settings or use another working directory to get around a denied operation.
- Do not delete existing implementation or user changes to satisfy test order. If implementation began first, preserve it, add the behavior test, and report that a red result was not observed against the untouched baseline.
- If a test is unsafe or destructive, inspect its effects and use an isolated fixture or disposable workspace. Do not escalate execution authority to make it run.

This Skill adapts the red-green-refactor workflow from [Superpowers' test-driven-development Skill](https://github.com/obra/superpowers/blob/main/skills/test-driven-development/SKILL.md). It follows DSH's scoped verification and permission rules; the Skill wording is original to DSH.
