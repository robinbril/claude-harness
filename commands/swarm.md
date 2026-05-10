---
name: swarm
description: Split a task across parallel subagents for speed
---

# /swarm — Parallel Subagent Execution

Break a task into independent parts and run them simultaneously across multiple subagents.

## Usage

- `/swarm <task description>` — auto-split and execute in parallel
- `/swarm analyze <path>` — multi-perspective analysis of code at path
- `/swarm refactor <path>` — parallel refactoring with safety checks

## Process

### 1. Decompose

Read the task and split into independent subtasks. Rules:
- Each subtask must be completable without results from other subtasks
- If tasks depend on each other, run them sequentially, not in parallel
- Max 5 parallel agents (diminishing returns beyond that)
- Each agent gets Sonnet 4.6 unless the task needs deep reasoning (then Opus)

### 2. Assign Roles

Pick the right agent type per subtask:

| Task type | Agent |
|---|---|
| Code review | code-reviewer |
| Security scan | security-reviewer |
| Architecture analysis | architect |
| Implementation planning | planner |
| Test writing | tdd-guide |
| Build fixing | build-error-resolver |
| Dead code cleanup | refactor-cleaner |
| Documentation | doc-updater |
| General research | Explore |
| Custom task | general-purpose |

### 3. Launch

Fire all independent agents in a single message (parallel tool calls). Each agent gets:
- Clear task description with file paths
- Context about the overall goal
- What to output (findings, code, plan, etc.)

### 4. Synthesize

When all agents complete:
- Merge findings, remove duplicates
- Resolve conflicts between agent recommendations
- Present a unified report

## Output

```
Swarm: <task> — N agents
━━━━━━━━━━━━━━━━━━━━━━━━

Agent 1 (code-reviewer): [summary]
Agent 2 (security-reviewer): [summary]
Agent 3 (architect): [summary]

━━━━━━━━━━━━━━━━━━━━━━━━
Merged findings:
  [priority-ordered list of actions]

Conflicts:
  [where agents disagreed + resolution]
```

## Common Swarm Patterns

### `/swarm analyze src/`
Spawns: code-reviewer + security-reviewer + architect
Each reviews the same codebase from their perspective.

### `/swarm "add feature X"`
Spawns: planner (design) + Explore (find related code) + tdd-guide (write tests)
Planner designs, explorer finds integration points, tdd writes test stubs.

### `/swarm refactor src/service.py`
Spawns: code-reviewer (current issues) + refactor-cleaner (dead code) + architect (target design)
Produces a refactoring plan with safety checks.

## Rules

- Always use `model: "sonnet"` unless the subtask explicitly needs deeper reasoning
- Never launch more than 5 agents (context overhead kills the benefit)
- Each agent must have a clear, bounded task. Vague prompts produce vague results.
- Synthesize yourself. Don't delegate understanding.
