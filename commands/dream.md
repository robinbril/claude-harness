---
name: dream
description: Consolidate daily logs into structured memory (weekly housekeeping)
---

# /dream — Log Consolidation

Distill raw `/log` entries from the past week into structured, long-term memory. This is the weekly housekeeping counterpart to `/improve` (which handles corrections from session transcripts).

## Scope

`/dream` reads **daily log files** and produces **memory files**.
`/improve` reads **session transcripts** and produces **lessons-learned entries**.

They don't overlap. Run `/dream` weekly, `/improve` after sessions with corrections.

## Process

### 1. Orient

Read daily logs from `~/.claude/projects/<slug>/memory/logs/` since last dream date (stored in `~/.claude/projects/<slug>/memory/last_dream.md`). If no last_dream file, read last 7 days.

### 2. Gather

From the logs, identify:
- **Patterns**: topics that come up repeatedly, workflow bottlenecks
- **Decisions**: architectural or tool choices worth remembering
- **Open threads**: work mentioned but not completed
- **New knowledge**: codebase insights, user preferences, external references

### 3. Consolidate

For each finding, check `MEMORY.md` for existing memories to update. Then:
- Recurring patterns with user reasoning → `feedback` memory
- Project-specific knowledge → `project` memory
- User preference or context → `user` memory
- External resource pointer → `reference` memory

Follow the existing memory format (frontmatter + content). Update existing memories before creating new ones.

### 4. Prune

- Update memories that logs contradict
- Flag stale memories (>30 days, never referenced)
- Write `last_dream.md` with today's date

## Output

```
Dream Report — YYYY-MM-DD
━━━━━━━━━━━━━━━━━━━━━━━━━
Logs processed:    N days
Memories created:  N
Memories updated:  N
Memories pruned:   N
Open threads:      N

Created:
  + [filename] — [one-line description]

Updated:
  ~ [filename] — [what changed]

Open threads:
  -> [unfinished item from logs]
```

## AgentMemory Sync

After consolidating local memory files, sync to agentmemory if the server is running (http://localhost:3111):

1. For each created or updated memory, POST to `/agentmemory/remember`:
   ```json
   {
     "content": "<memory content>",
     "type": "<memory type>",
     "concepts": ["<project>", "<topic>"],
     "metadata": { "source": "dream", "name": "<memory name>" }
   }
   ```

2. Run `memory_consolidate` via MCP to trigger agentmemory's 4-tier consolidation pipeline

3. Report agentmemory sync status in the dream output

## Rules

- Never modify log files (read-only on logs, write-only on memory)
- Be conservative: only create memories for things useful across sessions
- Skip ephemeral task details
- No duplicate memories
- Always sync to agentmemory after local writes
