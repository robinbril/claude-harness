---
name: log
description: Append timestamped entry to daily log (KAIROS-style append-only)
---

# /log — Daily Session Log

Append-only daily logs. Never edit previous entries, never reorganize. Just append.

## Path

`~/.claude/projects/<slug>/memory/logs/YYYY/MM/YYYY-MM-DD.md`

Use the slug from the current working directory (same convention as the memory system).

## Behavior

- `/log` without text: auto-summarize what happened this session (files changed, decisions made, open items). Keep it to 2-3 bullets max.
- `/log <tekst>`: log that exact text.

## Format

Create file with header `# Log YYYY-MM-DD` if it doesn't exist. Append:

```
- **HH:MM** — <entry>
```

24h time. Current actual time. Create directories as needed.

## Rules

- Append only. Never modify existing lines.
- One line per entry unless genuinely multi-part.
- Write in the language the user used most recently.
- No fluff, no commentary. Just log the entry and confirm with the file path.

## Relationship to /improve and /dream

`/log` creates raw daily entries. `/dream` consolidates them into structured memory. `/improve` extracts corrections from session transcripts into lessons-learned. All three are complementary, none overlap:

```
/log → raw daily facts (append-only)
/dream → consolidates /log entries into memory files (weekly)
/improve → extracts corrections from transcripts into lessons-learned.md
```
