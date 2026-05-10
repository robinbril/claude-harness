---
name: improve
description: >
  Self-improving memory pipeline (v2). Uses QMD semantic search to find corrections
  and lessons from recent sessions. Proposes and validates changes to per-project rule files.
  Run after sessions where new patterns were discovered or errors were fixed.
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
---

# /improve — Self-Improving Memory Pipeline (v2)

## Trigger

When the user types `/improve`, run this pipeline fully autonomously. Do not ask for confirmation. Report what changed at the end.

---

## Step 1: Detect project

Detect current project from CWD:
- Try to match the CWD against known project keys configured by the user (e.g. via `IMPROVE_PROJECT_MAP` env or a local config). Each key maps to project rules under `<project>/.claude/rules/` and a qmd index name.
- Otherwise → global, rules: `~/.claude/rules/common/`, qmd: claude-rules

---

## Step 2: Query QMD for corrections

Check if QMD is available:
```bash
curl -s http://localhost:8181/health --max-time 1
```

If available, run these queries against the `sessions` collection (limit 10 each):
```bash
qmd query "user corrected Claude mistake" --collection sessions -n 10 --json
qmd query "nee doe niet gebruik verkeerd" --collection sessions -n 10 --json
qmd query "because want omdat reden explanation" --collection sessions -n 10 --json
```

Also query the project collection for existing rules:
```bash
qmd query "lessons learned rules corrections" --collection <project-qmd> -n 5 --json
```

If QMD is NOT available, fall back to Step 3b.

---

## Step 3a: QMD path — extract correction pairs

From the QMD results, extract passages that contain:
- A user correction ("nee", "doe niet", "wrong", "fout", "stop", "gebruik")
- With explicit reasoning ("omdat", "because", "want", "reden", "since")

For each valid pair: note the rule being corrected and the stated reason.

---

## Step 3b: Fallback path — read recent transcripts

Find the 5 most recent `.jsonl` files under `~/.claude/projects/` (across all project slugs; sort by mtime, skip files under 10KB).

For each, extract `type: "user"` messages and look for correction patterns with explicit reasoning.

---

## Step 4: Read current project rules

Read the current lessons-learned.md for the detected project:
```
<project>/.claude/rules/lessons-learned.md
```

---

## Step 5: Propose and validate changes

For each correction+reasoning pair found:

1. Check if it's already covered by an existing rule (skip if duplicate)
2. Only proceed if the user explicitly stated reasoning (not inferred)
3. Format: `**[Rule]**: [what to do]. Reden: [why — one sentence, max 120 chars].`

Apply strict criteria (mirror session-learn.js validator):
- REJECT: vague ("be careful", "check things")
- REJECT: one-time mistake that won't recur
- REJECT: applies only to a specific file/task, not generally
- APPROVE only: explicit reasoning + concrete + repeatable

Show proposed changes to the user before writing:
```
Proposed additions to lessons-learned.md:
- [entry 1]
- [entry 2]

Reject (reason):
- [entry] → vague / already covered / one-time
```

Ask: "Write these? (y/n)"

---

## Step 6: Write approved entries

Append approved entries to `<project>/.claude/rules/lessons-learned.md`.

Format:
```markdown
- **Rule**: what to do. Reden: why.
```

---

## Step 7: Report

```
/improve complete

Project: [id]
QMD available: yes/no
Corrections found: N
Proposed: N
Approved: N, Rejected: N

Written to: <project>/.claude/rules/lessons-learned.md
New entries:
- [entry 1]
```

---

## Notes

- Do NOT commit. session-learn.js handles learning automatically at SessionEnd.
- Do NOT modify other rule files (coding-style, agents, etc.).
- Do NOT modify infra-registry.md or platform-context.md — those are stable references.
- /improve is for manual runs when you want to extract lessons mid-session.
