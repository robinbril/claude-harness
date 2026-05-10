---
name: ship
description: Review + test + commit pipeline — one command to ship changes
---

# /ship — Ship It Pipeline

End-to-end pipeline: review your changes, run tests, commit if clean. One command from "done coding" to "committed".

## Modes

- `/ship` — review + test + commit all uncommitted changes
- `/ship <message>` — same, but use the provided commit message
- `/ship --no-test` — skip tests (use sparingly)

## Pipeline

### 1. Preflight

```bash
git status
git diff --stat
```

If no changes, stop: "Niets te shippen."

### 2. Review (inline /review)

Run the same review as `/review` on uncommitted changes. If any `BUG` or `SEC` findings:
- Show them
- Stop the pipeline
- Say "Fix deze eerst, dan opnieuw `/ship`"

### 3. Test

Detect and run the project's test suite:
- Python: `uv run pytest tests/ -v --tb=short` (or `uv run --extra dev pytest`)
- Node: `npm test`
- .NET: `dotnet test`

If tests fail:
- Show failures
- Stop the pipeline
- Say "Tests falen. Fix of `/ship --no-test` als je weet wat je doet."

### 4. Commit

- Stage relevant files (never stage `.env`, credentials, or large binaries)
- Generate commit message from the changes if not provided:
  - Format: `<type>: <description>` (conventional commits)
  - Keep it under 72 chars
  - Add body if the change is complex
- Create the commit

### 5. Report

```
Shipped
━━━━━━━
Commit:  abc1234
Message: feat: add input validation to fo_odata_query
Files:   3 changed (+45 -12)
Tests:   12 passed
Review:  clean

Next: git push (handmatig, niet automatisch)
```

## Rules

- Never push. Alleen commit. Push is bewust handmatig (staat in deny rules).
- Never commit .env, secrets, credentials, .pem files.
- If `lessons-learned.md` says "commit pas na verify" and we're in a deploy context (ACA), warn the user.
- Always use conventional commit format.
- Don't amend previous commits. Always new commits.
