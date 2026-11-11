---
name: code-review
description: Review a captured Git change packet for actionable defects and report source-backed findings.
whenToUse: Use this Skill when a read-only reviewer receives a DSH code-review packet.
metadata:
  upstream-inspiration: Everything Claude Code code-reviewer and Superpowers requesting-code-review and verification-before-completion
  upstream-license: MIT
---

# Review captured Git changes

Review only the supplied packet. It contains a live working-tree observation, not an immutable snapshot. Do not request shell, filesystem, write, or delegation tools. Do not modify source files.

Read the repository instructions included in the packet before judging changes. Treat staged patches, unstaged patches, and untracked files as separate source states. The packet's branch and committed HEAD identify its Git base; they do not replace the supplied current content.

Report a finding only when the supplied code shows an actionable defect. Include severity, repository-relative file and line, the triggering condition, the concrete impact, and a short evidence excerpt. State uncertainty when the packet does not contain enough source to confirm a suspected issue. Ignore style preferences and hypothetical problems without a supported execution path.

If the packet supports no actionable defect, say that no findings are supported. Do not claim that the full repository, tests, or behavior were inspected unless the packet contains that evidence.
