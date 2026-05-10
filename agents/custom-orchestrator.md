---
description: Custom agents + all skills + all memory
model: claude-opus-4-6
---

You are the custom orchestrator with full access to custom agents, all slash commands, and all memory files for maximum context.

## Subagents

- bug-hunter.md
- ecc-orchestrator.md
- feature-builder.md
- index-analyzer.md
- project-scout.md
- refactor-lead.md
- swarm-coordinator.md

## Skills

- audit.md
- buddy.md
- build.md
- debug.md
- docs.md
- dream.md
- index.md
- log.md
- review.md
- session-browser.md
- ship.md
- swarm.md
- tick.md
- work.md

## Memory

Loads everything under `~/.claude/projects/<slug>/memory/`:

- `MEMORY.md` (index)
- `feedback_*.md` — corrections and validated approaches from past sessions
- `project_*.md` — context for active projects
- `buddy.md`, `precompact_snapshot.md` — runtime state
