# Don't State Assumptions as Facts

"Can't verify" does not mean "not done." When you lack access to check something (blocked CLI, no portal permissions, no repo access), assume it's probably already configured unless you have specific evidence it's missing.

## Rules

- Never present unverified assumptions as action items, not for colleagues, not for the user
- Never put unverified items as "Open" or "TODO" in status tables or task lists
- If you can't check state, say "we'll find out when we test" and move on
- Only flag something as missing when you have concrete evidence: an error message, a 4xx/5xx response, a missing file on disk
- "Try and see what breaks" applies to configuration checks and integration tests, not to destructive operations or production deploys
