---
name: work
description: Autonomous work loop — pick tasks, execute, repeat until done
---

# /work — Autonomous Work Mode

Keep working without waiting for user input. Pick the next task, do it, move on.

## Behavior

### With task list
If there are open tasks (from TaskList), pick the highest priority incomplete task and execute it. After completing it, mark it done, pick the next one, continue.

### With instructions
`/work <instruction>` — break the instruction into subtasks, then execute them sequentially. Create tasks for tracking.

### With git context
If no tasks and no instruction, check `git status` and recent `/log` entries. Look for:
- Uncommitted work that needs tests
- TODOs in recently changed files
- Failing tests that need fixing
- Files changed but not committed

If nothing to do, say so and stop.

## Work Loop

For each task:
1. Read the relevant code (use `/index` context if PROJECT_INDEX.json exists)
2. Make the change
3. Run tests if they exist (`uv run pytest` / `npm test` / `dotnet test`)
4. If tests fail, fix and retry (max 3 attempts)
5. Mark task complete
6. Pick next task

## Guardrails

- Never commit automatically (that's `/ship`)
- Never push or deploy
- Never delete files without the user having asked for it
- If stuck for more than 2 attempts on the same error, stop and report
- If a task is ambiguous, skip it and note why
- Show a one-line status update between tasks:
  ```
  [3/7] Added input validation to fo_odata_query — tests pass
  ```

## End condition

Stop when:
- All tasks are complete
- No more work is found
- You hit a blocker you can't resolve
- You've been working for more than 15 tasks (report progress, ask to continue)

## Final report

```
Work session complete
━━━━━━━━━━━━━━━━━━━━
Completed: N/M tasks
Tests:     all passing / N failures
Changed:   N files
Duration:  ~N minutes

Remaining:
  → [incomplete task + why]

Ready for: /review → /ship
```

## For use with /loop

`/loop 1m /work` makes Claude continuously work through tasks. Each loop iteration picks up where the last left off. The 1-minute interval gives breathing room between tasks.
