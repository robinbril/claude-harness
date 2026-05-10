---
name: session-browser
description: Visual session browser — browse Claude Code history, copy resume commands
allowed-tools: Bash
---

# Session Browser

Launch the visual session browser at http://localhost:7337.

Run this command:

```bash
node "$HOME/.claude/scripts/session-browser/server.mjs"
```

After launching, open http://localhost:7337 if the browser didn't open automatically. Features:
- Browse sessions grouped by project
- Search across all sessions
- Copy `claude --resume <id>` commands
- View transcript previews
- Token usage and cost estimates

Press Ctrl+C in the terminal to stop the server.
