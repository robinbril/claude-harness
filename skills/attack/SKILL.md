---
name: attack
description: >
  Recursive multi-agent orchestration for complex goals. A planner decomposes the goal
  into a task graph, spawns workers and verifiers in parallel via the Agent tool with
  worktree isolation, tracks state in .attack/<slug>/, recovers from failures, and
  converges when all tasks are verified. Inspired by Cursor's /orchestrate plugin,
  adapted for Claude Code's Agent tool and native worktree support.
---

# /attack

## Invocation

```
/attack <goal>
```

The planner reads the goal, decomposes it into a task graph, and drives the full
execution loop until every leaf task is verified or the plan is restructured after
repeated failure.

---

## Core Principles

1. **Planners do not write code.** The planner reasons, decomposes, spawns, reads
   handoffs, and reacts. All code, tests, and file changes happen inside worker agents.

2. **Workers are isolated.** Each worker runs in its own worktree so they can modify
   files without conflicting. The planner merges results after verification passes.

3. **Every task has a verifier.** No task is considered done until a separate verifier
   agent confirms the acceptance criteria. Workers and verifiers are different agents.

4. **Verifiers do not fix.** A verifier that finds a failure writes a structured
   failure handoff and stops. The planner decides what to do next.

5. **Independent tasks spawn in parallel.** If tasks A and B have no shared files or
   dependencies, they are dispatched in the same Agent() invocation message.

6. **Retry before restructure, restructure before abandon.** One failure triggers a
   fix worker. Two identical failures on the same task trigger plan restructuring.
   The planner may split the task, change the approach, or escalate.

7. **State is durable.** Every plan mutation is written to `.attack/<slug>/` before
   agents are spawned. If the orchestration session is interrupted, it can be resumed
   by re-reading the state files.

---

## Node Types

| Type | Model | Role | Can Write Files? |
|------|-------|------|-----------------|
| planner | opus | Decomposes goal, owns task graph, reacts to handoffs | No (only .attack/ state) |
| subplanner | sonnet | Decomposes a complex subtask into further leaf tasks | No (only handoff output) |
| worker | sonnet | Implements a single leaf task in an isolated worktree | Yes (own worktree only) |
| verifier | haiku | Checks worker output against acceptance criteria | No (read-only + tests) |

Use haiku for verifiers whose check is mechanical (test run, lint, file existence).
Use sonnet for verifiers whose check requires judgment (code review, output quality).

---

## Execution Model

### Agent Tool Usage

All subagents are spawned via the `Agent()` tool with `isolation: "worktree"`:

```
Agent(
  prompt: <handoff template, filled in>,
  model: <per node type above>,
  isolation: "worktree"
)
```

Worktree isolation means each agent gets a clean copy of the repo at HEAD in a
separate git worktree. Changes stay in the worktree until the planner explicitly
merges them. Workers commit to their worktree; the planner cherry-picks or merges
after verification passes.

### Parallel Dispatch

To spawn two independent workers in parallel, include both Agent() calls in the
same response message. Do not wait for one before the other.

```
// Both fire concurrently:
Agent(prompt: worker_handoff_for_task_A, model: sonnet, isolation: worktree)
Agent(prompt: worker_handoff_for_task_B, model: sonnet, isolation: worktree)
```

Only tasks with a shared file or a data dependency must be serialized.

### Handoff Flow

```
planner writes task to plan.json
  -> spawns worker (Agent, worktree)
     -> worker writes result to handoffs/<task_id>_worker.md
  -> planner reads handoff
  -> spawns verifier (Agent, worktree=same as worker or fresh)
     -> verifier writes result to handoffs/<task_id>_verifier.md
  -> planner reads verifier handoff
     -> PASS: marks task done, merges worktree
     -> FAIL attempt 1: spawns fix-worker for same task
     -> FAIL attempt 2: restructures plan for that subtree
```

---

## State Layout

All state lives under `.attack/<rootSlug>/` in the working directory.

```
.attack/
  <rootSlug>/
    plan.json          # Full task graph + current status
    state.json         # Planner loop position, retry counts, merge log
    handoffs/
      <taskId>_worker.md      # Worker result handoff
      <taskId>_verifier.md    # Verifier result handoff
      <taskId>_subplanner.md  # Subplanner decomposition handoff
```

`rootSlug` is the goal string lowercased, spaces replaced with `-`, truncated to 40
characters. Example: `add-oauth-login-to-api`.

---

## Plan JSON Schema

```json
{
  "goal": "string — original /attack goal",
  "slug": "string — rootSlug",
  "createdAt": "ISO 8601",
  "updatedAt": "ISO 8601",
  "tasks": [
    {
      "id": "string — short unique id, e.g. T1, T2, T1a",
      "title": "string — one-line description",
      "type": "leaf | compound",
      "status": "pending | in_progress | worker_done | verified | failed | restructured",
      "dependsOn": ["taskId", "..."],
      "acceptanceCriteria": ["string", "..."],
      "worktreePath": "string | null — set when worker starts",
      "retryCount": 0,
      "failureReason": "string | null — last verifier failure summary",
      "children": ["taskId", "..."]
    }
  ]
}
```

Status transitions:

```
pending -> in_progress (planner spawns worker)
in_progress -> worker_done (worker handoff received)
worker_done -> verified (verifier handoff: pass)
worker_done -> failed (verifier handoff: fail, retryCount < 2)
failed -> in_progress (fix-worker spawned, retryCount++)
failed -> restructured (retryCount >= 2, planner splits/replaces task)
```

---

## State JSON Schema

```json
{
  "phase": "decompose | spawn | verify | converge | done | error",
  "pendingMerges": ["taskId", "..."],
  "mergedTasks": ["taskId", "..."],
  "retryCounts": { "taskId": 0 },
  "log": [
    { "ts": "ISO 8601", "event": "string" }
  ]
}
```

---

## Handoff Templates

### Worker Handoff

The planner fills this template and passes it as the Agent prompt.

```markdown
# Worker Task: <title>

## Goal
<one paragraph describing what must be implemented>

## Acceptance Criteria
<bulleted list — these are checked by the verifier>
- ...

## Files in Scope
<list of files the worker is allowed to create or modify>
- ...

## Files Out of Scope
Do NOT modify anything outside the files listed above.

## Context
<any background the worker needs — interfaces, existing patterns, constraints>

## Output Instructions
When done, write a handoff file to:
  .attack/<rootSlug>/handoffs/<taskId>_worker.md

Use the worker result template below exactly.

---
# Worker Result: <taskId>

## Status
DONE | BLOCKED

## Summary
<2-3 sentences of what was implemented>

## Files Changed
- path/to/file.ts — description
- ...

## Notes for Verifier
<anything the verifier should know — edge cases, known limitations, test commands>

## Blocker (if BLOCKED)
<describe what is missing and what the planner should do>
---
```

### Verifier Handoff

```markdown
# Verifier Task: <title>

## Task ID
<taskId>

## Worker Handoff Location
.attack/<rootSlug>/handoffs/<taskId>_worker.md

## Acceptance Criteria to Check
<same list as the worker handoff>
- ...

## How to Verify
<specific commands or checks — e.g. "run npm test -- --testPathPattern=auth",
"read the file and confirm X", "check that Y is exported">

## Output Instructions
Write result to:
  .attack/<rootSlug>/handoffs/<taskId>_verifier.md

Use the verifier result template below exactly.

---
# Verifier Result: <taskId>

## Verdict
PASS | FAIL

## Criteria Results
- [PASS/FAIL] criterion 1 — reason
- [PASS/FAIL] criterion 2 — reason
- ...

## Failure Summary
<if FAIL: 1-2 sentences the planner can use to brief a fix-worker>

## Evidence
<test output, file snippet, or command result that supports the verdict>
---
```

### Subplanner Handoff

Used when the planner encounters a compound task too complex for a single worker.

```markdown
# Subplanner Task: <title>

## Parent Task ID
<taskId>

## Compound Goal
<description of the compound task that needs further decomposition>

## Constraints
- All leaf tasks must be independently verifiable
- Leaf tasks must have non-overlapping file scopes where possible
- Maximum 5 leaf tasks per subplanner invocation

## Output Instructions
Write result to:
  .attack/<rootSlug>/handoffs/<taskId>_subplanner.md

Use the subplanner result template below exactly.

---
# Subplanner Result: <parentTaskId>

## Leaf Tasks
Each entry becomes a new task node in plan.json.

### <parentTaskId>a
- title: ...
- acceptanceCriteria: [...]
- filesInScope: [...]
- dependsOn: [] or [<parentTaskId>b, ...]
- context: ...

### <parentTaskId>b
- title: ...
- acceptanceCriteria: [...]
- filesInScope: [...]
- dependsOn: []
- context: ...

## Rationale
<why this decomposition makes sense>
---
```

---

## Planner Loop

The planner runs this loop until `state.phase == "done"` or a hard stop condition is met.

### Phase 1: Decompose

1. Read the goal from the `/attack` invocation.
2. Write initial `plan.json` and `state.json` to `.attack/<slug>/`.
3. Break the goal into 2-6 top-level tasks. For each task, decide: leaf (single worker) or compound (needs subplanner).
4. Set `state.phase = "spawn"`.
5. Update TodoList with one item per task.

### Phase 2: Spawn

For each task in `pending` status whose `dependsOn` tasks are all `verified`:

- If compound: spawn a subplanner Agent. Wait for its handoff. Expand plan.json with leaf tasks. Mark compound task as `restructured` (it is replaced by its children).
- If leaf: spawn a worker Agent (worktree). Mark task `in_progress`.

Dispatch all independent workers in the same message (parallel).

### Phase 3: Verify

For each task in `worker_done` status:

- Read `handoffs/<taskId>_worker.md`.
- If worker returned BLOCKED: treat as FAIL, increment retry count.
- Else: spawn a verifier Agent (worktree, read-only sufficient).
- Wait for `handoffs/<taskId>_verifier.md`.
- If PASS: mark task `verified`, add to `pendingMerges`, check off TodoList item.
- If FAIL and `retryCount < 2`: spawn a fix-worker (see Failure Recovery), mark task `in_progress`, increment `retryCount`.
- If FAIL and `retryCount >= 2`: spawn a subplanner to restructure that subtree.

### Phase 4: Merge

For each task in `pendingMerges`:

- Cherry-pick or merge the worktree commits into the main working tree.
- Record in `state.mergedTasks`.
- Remove from `pendingMerges`.

### Phase 5: Converge

When all tasks are `verified` or `restructured` (with children all verified):

1. Run full test suite on merged working tree.
2. If green: set `state.phase = "done"`. Write final report.
3. If red: identify failing task, set to `failed`, re-enter Phase 2 for that task.

### Hard Stop Conditions

Stop and report to the user if:

- Any task reaches `retryCount >= 2` AND restructuring produces the same leaf tasks again (cycle detected).
- Total agent spawns exceed 30 in one `/attack` session.
- A worker returns BLOCKED with "missing external dependency" (e.g., missing API key, missing schema).

---

## Prompt Templates

### Planner Prompt (used internally — this agent IS the planner)

The planner does not receive a prompt template. It IS Claude Code reading this skill
and running the loop. The planner maintains all context in the `.attack/` state files.

### Worker Prompt

Fill the Worker Handoff template above. Key rules:

- Include the exact acceptance criteria from `plan.json`.
- List only the files in scope. Workers that touch out-of-scope files produce merges that fail.
- Paste relevant interfaces or type signatures as context — do not tell the worker to "look around."
- Specify the exact test command to run so the verifier can reproduce.

### Verifier Prompt

Fill the Verifier Handoff template above. Key rules:

- Point the verifier at the worker handoff so it can read the "Notes for Verifier" section.
- List acceptance criteria verbatim from `plan.json`.
- Specify mechanical checks first (test commands, lint) so haiku can handle them.
- For judgment-based checks (code quality, correctness), use sonnet instead of haiku.

### Fix-Worker Prompt

Same as Worker Handoff template, with one additional section:

```markdown
## What Failed
<paste the Failure Summary from the verifier handoff>

## What Not to Change
<list any criteria that already passed — do not regress them>
```

### Subplanner Prompt

Fill the Subplanner Handoff template above. Keep it narrow: the subplanner only needs
the compound task description and the constraints. It does not need the full plan.

---

## Failure Recovery Rules

| Scenario | retryCount | Action |
|----------|-----------|--------|
| Verifier FAIL, first time | 0 -> 1 | Spawn fix-worker with failure summary |
| Verifier FAIL, second time | 1 -> 2 | Spawn subplanner to restructure subtree |
| Worker BLOCKED (missing dep) | any | Escalate to user immediately |
| Cycle detected in restructure | N/A | Escalate to user with diagnosis |
| 3 consecutive PASS then FAIL after merge | N/A | Spawn integration-verifier for full suite |

When restructuring (retryCount >= 2):

1. Mark original task `restructured`.
2. Spawn a subplanner with the original task description plus the two failure summaries.
3. Subplanner produces new leaf tasks with a different decomposition strategy.
4. New leaf tasks start with `retryCount = 0`.
5. If the new leaf tasks are structurally identical to the original, stop and escalate.

---

## TodoList Usage

The planner maintains a TodoList entry per task using this format:

```
[status] T<id>: <title>
```

Status values:
- `[ ]` pending
- `[~]` in progress (worker or verifier running)
- `[x]` verified and merged
- `[!]` failed, fix-worker spawned
- `[R]` restructured

Update the TodoList after every state transition. This is the primary observability
mechanism — it shows the user what is happening without requiring them to read JSON.

---

## Quick Reference

| Question | Answer |
|----------|--------|
| What model for planning? | opus |
| What model for workers? | sonnet |
| What model for simple verification? | haiku |
| What model for judgment verification? | sonnet |
| Where is task graph stored? | `.attack/<slug>/plan.json` |
| Where are handoffs stored? | `.attack/<slug>/handoffs/` |
| How many retries before restructure? | 2 |
| How to run parallel workers? | Same Agent() message, multiple calls |
| What is worktree isolation? | Each agent gets a separate git worktree via `isolation: "worktree"` |
| When does the planner write code? | Never |
| When is a task "done"? | When verifier returns PASS and worktree is merged |
| What triggers user escalation? | Cycle detected, BLOCKED on external dep, spawn limit (30) reached |

---

## Example Session Trace

Goal: `add rate limiting to all public API endpoints`

```
Planner decomposes ->
  T1: audit public endpoints and document rate limit requirements  [leaf]
  T2: implement rate limit middleware                              [leaf]
  T3: apply middleware to all routes                              [leaf, dependsOn: T1, T2]
  T4: write integration tests                                     [leaf, dependsOn: T3]

Spawn T1 and T2 in parallel (independent) ->
  Worker T1 done -> Verifier T1 PASS -> merge
  Worker T2 done -> Verifier T2 PASS -> merge

T3 now unblocked -> spawn Worker T3 ->
  Worker T3 done -> Verifier T3 FAIL (2 routes missed) ->
  Fix-worker T3 spawned (retryCount=1) ->
  Worker T3b done -> Verifier T3b PASS -> merge

T4 now unblocked -> spawn Worker T4 ->
  Worker T4 done -> Verifier T4 PASS -> merge

Full suite green -> state.phase = done
```

Total agent spawns: 9 (2 workers T1/T2 parallel, 2 verifiers parallel, worker T3,
verifier T3 fail, fix-worker T3, verifier T3b, worker T4, verifier T4).
