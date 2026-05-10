---
name: tick
description: Proactive check-in — status, suggestion, warnings
---

# /tick — Proactive Check-in

Quick situational awareness. Review current state, suggest next action, flag risks.

## What to check

1. `git status` of current directory (uncommitted changes, unpushed commits)
2. Last 3 entries from today's `/log` file (if it exists)
3. Current task list (if tasks exist)
4. Time of day context

## Output

Keep it tight. Three lines max:

```
-- tick --------------------------------
  Status:  <one line>
  Suggest: <next action>
  Watch:   <risk or blocker, omit if none>
----------------------------------------
```

## Behavior

- If nothing is going on, say "niets te melden" and stop. Don't invent work.
- If uncommitted changes exist, mention it.
- If there's a long gap since last commit, nudge.
- If memory has open threads relevant to current directory, surface them.
- If it's end of day (after 17:00), suggest wrapping up and running `/log`.
- Write in Dutch.

## Proactive mode

Combine with `/loop` for KAIROS-style periodic check-ins:

```
/loop 5m /tick
```

In loop mode, output nothing if there's nothing to report. Only speak up when something changed or needs attention.
