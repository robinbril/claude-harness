---
name: review
description: Quick code review of recent changes (lighter than /audit)
---

# /review — Quick Code Review

Fast, focused review of what changed. Not a full audit, just a senior engineer looking at your diff.

## Scope

- `/review` — review uncommitted changes (`git diff` + `git diff --cached`)
- `/review HEAD~3` — review last 3 commits
- `/review <file>` — review specific file

## Process

1. Run `git diff` (or specified range) to get the changeset
2. Read each changed file fully to understand context
3. Review for these categories only:

**Bugs** — logic errors, off-by-ones, null derefs, race conditions, missing await
**Security** — hardcoded secrets, injection, unvalidated input, exposed data in logs
**Design** — wrong abstraction level, coupling, naming that misleads
**Edge cases** — empty inputs, large inputs, network failures, concurrent access

Skip style, formatting, and minor nits. Focus on things that break in production.

## Output

```
Review: N files changed, +X -Y lines
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[For each finding:]
[severity] file:line — issue
  → fix: concrete suggestion

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Verdict: SHIP IT / FIX FIRST / RETHINK
```

Severity levels: `BUG`, `SEC`, `DESIGN`, `EDGE`

If everything looks good, just say "SHIP IT" and move on. Don't pad the review with filler.

## Rules

- Read the full file, not just the diff. Context matters.
- Don't flag things that are obviously intentional.
- Concrete fixes only, no vague "consider improving".
- If you find a security issue, flag it as blocking.
- Write in the language the code comments use.
