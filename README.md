# Agentic Development Harness

A persistent configuration layer for Claude Code that adds memory, specialized agents, automated hooks, and a visual dashboard.

---

## Quick Start

**Prerequisites:** Node.js >= 20, Docker Desktop, Claude Code CLI

```sh
# Install everything
node import.mjs

# Start the memory server
agentmemory --tools all

# Start Mission Control
node ~/.claude/scripts/session-browser/server.mjs
# Open: http://localhost:7337
```

---

## What's Inside

### Directory Structure

```
claude-harness-export/
├── agents/          # 37 specialized subagent definitions (.md)
├── commands/        # 17 slash commands (.md)
├── config/
│   ├── settings.json              # Hooks, permissions, model, theme
│   ├── mcp.json                   # MCP server wiring (agentmemory, qmd)
│   ├── env.example                # Claude Code env vars
│   └── agentmemory-env.example    # AgentMemory server env vars
├── modules/         # Session browser modules (db, sync, companion, etc.)
├── rules/
│   ├── common/      # 16 cross-language rules (always active)
│   ├── python/      # 5 Python-specific overrides
│   └── typescript/  # 5 TypeScript-specific overrides
├── scripts/         # Lifecycle scripts (hooks, session recall/learn, guards)
├── session-browser/ # Mission Control web server
├── skills/          # 33 custom skill definitions
└── templates/       # Reusable document templates
```

---

### Rules (26 files total, 16 common)

Rules are loaded automatically by Claude Code based on the active language or project context.

| File | What it controls |
|------|-----------------|
| `common/agents.md` | Which agents to spawn, when, and in parallel vs. sequential |
| `common/coding-style.md` | Immutability, file size limits, error handling, input validation |
| `common/development-workflow.md` | Full feature lifecycle: research, plan, TDD, review, commit |
| `common/git-workflow.md` | Commit message format, PR process, branch discipline |
| `common/hooks.md` | Hook types, when to auto-accept permissions |
| `common/humanizer.md` | Writing style rules — no AI-speak, plain human voice |
| `common/karpathy-method.md` | Think before coding, surgical edits, minimum code |
| `common/lessons-learned.md` | Accumulated gotchas: PowerShell/az CLI, Docker, regex, deploys |
| `common/patterns.md` | Repository pattern, API response envelope |
| `common/performance.md` | Model selection (Haiku/Sonnet/Opus), context window management |
| `common/security.md` | Pre-commit checklist, secret management, security response protocol |
| `common/testing.md` | 80% coverage minimum, TDD red/green/improve cycle |
| `common/verify-before-assigning.md` | Verify deployed branch and target codebase before any change |
| `python/*.md` | Python overrides for style, hooks, patterns, security, testing |
| `typescript/*.md` | TypeScript overrides for style, hooks, patterns, security, testing |

---

### Commands (17 slash commands)

| Command | Description | When to use |
|---------|-------------|-------------|
| `/audit` | Code quality, security, performance deep review | Before any release or after significant changes |
| `/buddy` | Hatch or visit your AI companion | Casual check-in, morale |
| `/build` | Generate MCP servers, agent stacks, fix syntax, run tests | When building or repairing MCP tooling |
| `/debug` | MCP connectivity, D365/OData, Graph API, integration diagnostics | Integration failures |
| `/docs` | Auto-generate docs, Microsoft stack reference, OData help | Documentation tasks |
| `/dream` | Consolidate daily logs into structured memory | Weekly housekeeping |
| `/index` | Create or update PROJECT_INDEX.json | Entering a new project |
| `/log` | Append timestamped entry to daily log | Tracking decisions and progress |
| `/recall` | Search agentmemory for cross-session knowledge | Finding past decisions or patterns |
| `/review` | Quick code review of recent changes | Lighter than /audit, daily use |
| `/session-browser` | Open the visual session history browser | Browsing past Claude Code sessions |
| `/ship` | Review + test + commit pipeline | Shipping a feature end-to-end |
| `/swarm` | Split a task across parallel subagents | Large tasks with independent subtasks |
| `/tick` | Proactive check-in: status, suggestions, warnings | Quick orientation at start of day |
| `/work` | Autonomous work loop: pick tasks, execute, repeat | Long-running autonomous work |

---

### Skills (33 custom skills)

Skills are invoked automatically when the trigger description matches, or explicitly with the Skill tool.

**Development**

| Skill | Purpose |
|-------|---------|
| `attack` | Multi-agent orchestration (planner/worker/verifier model) |
| `improve` | Review changed code for reuse, quality, and efficiency |
| `mcp-builder` | Create MCP servers in Python (FastMCP) or TypeScript |
| `webapp-testing` | Test local web apps via Playwright |
| `web-artifacts-builder` | Multi-component React/Tailwind/shadcn artifacts |
| `algorithmic-art` | Generative art with p5.js |
| `skill-creator` | Create, modify, and benchmark skills |

**Azure & Cloud**

| Skill | Purpose |
|-------|---------|
| `azure-deploy` | Execute Azure deployments (azd up, terraform apply) |
| `azure-diagnostics` | Debug production issues in Container Apps, AKS, Functions |
| `azure-rbac` | Find least-privilege roles, generate Bicep/CLI assignments |
| `azure-skills` | Application Insights instrumentation guidance |
| `entra-app-registration` | Entra ID app registration, OAuth 2.0, MSAL setup |
| `ms365-tenant-manager` | M365 tenant admin: users, Exchange, Teams, Conditional Access |

**Documents & Output**

| Skill | Purpose |
|-------|---------|
| `docx` | Create, read, and edit Word (.docx) files |
| `pdf` | Extract, merge, split, watermark, OCR PDFs |
| `pptx` | Create and edit PowerPoint (.pptx) decks |
| `xlsx` | Create and edit Excel (.xlsx) spreadsheets |
| `doc-coauthoring` | Structured co-authoring workflow for specs and proposals |

**Design**

| Skill | Purpose |
|-------|---------|
| `canvas-design` | Static visual design output (.png, .pdf) |
| `frontend-design` | Production-grade web UI components |
| `theme-factory` | Apply or generate visual themes for artifacts |
| `brand-guidelines` | Anthropic brand colors and typography |
| `slack-gif-creator` | Animated GIFs optimized for Slack |

**Project-specific / Domain**

| Skill | Purpose |
|-------|---------|
| `humanizer` | Rewrite text to sound human, remove AI-speak |
| `azure-infra-subagents` | Infrastructure subagent patterns |
| `claw-code-parity` | CLAW 3D code parity checks |

---

### Agents (37 specialized agents)

| Agent | Role | Model | Auto-spawned when |
|-------|------|-------|-------------------|
| `architect` | System design, scalability | opus | Planning new features or architectural decisions |
| `bug-hunter` | Reproduce, diagnose, fix, verify | sonnet | Any bug or unexpected behavior |
| `build-error-resolver` | Fix build and TypeScript errors | sonnet | Build fails |
| `chief-of-staff` | Email/Slack triage, draft replies | opus | Managing multi-channel comms |
| `code-architect` | Feature architecture blueprints | sonnet | Before implementing a new feature |
| `code-explorer` | Trace execution paths, map architecture | sonnet | Navigating unfamiliar code |
| `code-reviewer` | Quality, security, maintainability review | sonnet | After writing or modifying code |
| `code-simplifier` | Simplify for clarity, preserve behavior | sonnet | After a complex implementation |
| `custom-orchestrator` | Full agent + skill + memory orchestration | opus | Custom orchestration workflows |
| `database-reviewer` | SQL, schema, Supabase, query optimization | sonnet | Writing SQL or designing schemas |
| `doc-updater` | Update READMEs, codemaps, docs | haiku | After significant code changes |
| `e2e-runner` | E2E tests with Playwright | sonnet | Critical user flows |
| `ecc-orchestrator` | All 22 ECC agents | opus | ECC-specific orchestration |
| `feature-builder` | Full-cycle feature with TDD and review | sonnet | Building a new feature end-to-end |
| `go-build-resolver` | Fix Go build and vet errors | sonnet | Go build fails |
| `go-reviewer` | Idiomatic Go, concurrency, error handling | sonnet | Any Go code change |
| `harness-optimizer` | Improve this harness configuration | sonnet | Tuning the harness itself |
| `index-analyzer` | Analyze PROJECT_INDEX.json | (default) | Deep codebase navigation |
| `loop-operator` | Monitor and intervene in agent loops | sonnet | Autonomous loops stalling |
| `performance-optimizer` | Bottlenecks, bundle size, memory leaks | sonnet | Performance issues |
| `planner` | Implementation plans for complex features | opus | Any non-trivial feature request |
| `project-scout` | Onboard new projects: index, explore, document | sonnet | Entering a new codebase |
| `python-reviewer` | PEP 8, type hints, Pythonic idioms | sonnet | Any Python code change |
| `refactor-cleaner` | Remove dead code, knip/depcheck analysis | sonnet | Code maintenance |
| `refactor-lead` | Safe incremental refactoring | opus | Large refactoring efforts |
| `security-reviewer` | OWASP Top 10, secrets, injection, SSRF | sonnet | Code handling auth or user input |
| `silent-failure-hunter` | Swallowed errors, bad fallbacks | sonnet | After error handling changes |
| `sp-brainstorming` | Explore requirements before implementation | (default) | Before any creative/feature work |
| `sp-dispatching-parallel-agents` | Split independent tasks across agents | (default) | 2+ independent parallel tasks |
| `sp-executing-plans` | Execute written plans with checkpoints | (default) | Running a prepared plan |
| `sp-subagent-driven-development` | Execute plans with independent subtasks | (default) | In-session parallel execution |
| `sp-systematic-debugging` | Structured debugging before proposing fixes | (default) | Any bug, test failure |
| `sp-test-driven-development` | Write tests before implementation | (default) | Any feature or bugfix |
| `sp-verification-before-completion` | Verify before claiming done | (default) | Before committing or creating PRs |
| `sp-writing-plans` | Write plans from specs before touching code | (default) | Multi-step tasks with a spec |
| `swarm-coordinator` | Parallel work with conflict prevention | sonnet | Large tasks needing multiple workers |
| `tdd-guide` | Test-driven development, 80%+ coverage | sonnet | New features, bug fixes |
| `typescript-reviewer` | Type safety, async correctness, Node security | sonnet | Any TypeScript/JavaScript change |

---

### Hooks (13 lifecycle hooks)

| Event | Script | What it does | Timeout |
|-------|--------|-------------|---------|
| `SessionStart` | `session-recall.js` | Injects cross-session memory into context | 5s |
| `SessionStart` | `save-account-info.js` | Captures current user/account for logging | 5s |
| `SessionStart` | `agentmemory/session-start.mjs` | Notifies AgentMemory of session open | 5s |
| `SessionEnd` | `session-learn.js` | Extracts learnings and writes to memory | 120s async |
| `SessionEnd` | `agentmemory/session-end.mjs` | Flushes AgentMemory session state | 10s async |
| `SessionEnd` | `auto_log.py` | Appends session summary to daily log | 5s |
| `UserPromptSubmit` | `i_flag_hook.py` | Checks `/index` flag and routes accordingly | 20ms |
| `UserPromptSubmit` | `periodic_reindex.py` | Triggers background reindex if stale | 20ms |
| `PreCompact` | `precompact-preserve.ps1` | Preserves important context before compaction | 5s |
| `PreToolUse` (Bash) | `guard-git-push.ps1` | Blocks pushes to disallowed remotes (configurable) | 3s |
| `PostToolUse` (Bash) | `verify-aca-deploy.ps1` | Checks Container App revision status after deploy commands | 30s |
| `Stop` | `notify-stop.ps1` | Desktop notification when Claude finishes | 5s |
| `Stop` | `agentmemory/stop.mjs` | Final AgentMemory flush on session stop | 15s async |

---

### Mission Control (Session Browser)

Start with: `node ~/.claude/scripts/session-browser/server.mjs` then open `http://localhost:7337`.

Features:
- **Session browser**: browse past Claude Code sessions, view transcripts, copy resume commands
- **3D office visualization** (CLAW 3D): navigate agents as desks in a virtual office
- **Agent and skill editor**: view and edit agent/skill definitions in-browser
- **Log viewer**: tail and search daily logs
- **Docs browser**: browse project documentation
- **System health**: memory server status, project stats, Claude config
- **Team sync**: share memory and skills across machines
- **Companion**: persistent AI companion with progression and visuals
- **Relationship graph**: visual map of sessions, agents, skills, and projects
- **Blur mode**: hide sensitive content for screen sharing

---

### AgentMemory Integration

AgentMemory is a persistent vector memory server that survives session boundaries.

- Server runs at `http://localhost:3111`
- Start with: `agentmemory --tools all`
- MCP tools exposed via `mcp.json` under the `agentmemory` server entry
- `SessionStart` hook injects relevant memories into context automatically
- `SessionEnd` and `Stop` hooks persist new learnings
- Use `/recall <query>` to search memory manually
- Configure via `agentmemory-env.example`: token budget, embedding provider, injection toggle

---

### /attack (Multi-Agent Orchestration)

`/attack` runs a planner/worker/verifier model for large tasks:

1. **Planner** breaks the task into independent subtasks
2. **Workers** execute in parallel, each scoped to their subtask
3. **Verifier** checks results, flags conflicts, requests fixes
4. Results are merged and a summary is returned

Use it when a task is too large for a single context window or has genuinely parallel work streams.

---

## Configuration

### Customizing for Your Setup

**Change the default model** — edit `model` in `settings.json`:
```json
{ "model": "claude-sonnet-4-6" }
```

**Add an MCP server** — add an entry to `mcp.json`:
```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["path/to/server.mjs"]
    }
  }
}
```

**Add a new rule** — create a `.md` file in `~/.claude/rules/common/` (or `python/`, `typescript/`). Claude Code loads rules from those directories automatically.

**Add a new command** — create `~/.claude/commands/mycommand.md`. It becomes available as `/mycommand`.

**Add a new skill** — create `~/.claude/skills/myskill/SKILL.md` with a `description:` field. The skill triggers when the description matches the user's request.

**Add a hook** — add an entry under the relevant event in `settings.json`:
```json
{
  "hooks": {
    "PostToolUse": [{
      "matcher": "Bash",
      "hooks": [{ "type": "command", "command": "...", "timeout": 10 }]
    }]
  }
}
```

### Environment Variables

| Variable | File | Purpose |
|----------|------|---------|
| `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` | `env.example` | Set to `1` to disable adaptive thinking tokens |
| `AGENTMEMORY_TOOLS` | `agentmemory-env.example` | Which MCP tools to expose (`all` or specific names) |
| `AGENTMEMORY_INJECT_CONTEXT` | `agentmemory-env.example` | Auto-inject memories at session start (`true`/`false`) |
| `TOKEN_BUDGET` | `agentmemory-env.example` | Max tokens for injected memory context (default: 2000) |
| `EMBEDDING_PROVIDER` | `agentmemory-env.example` | Embedding backend (`local` uses a bundled model, no API key needed) |

---

## Architecture

The harness is a set of plain files that Claude Code loads from `~/.claude/`. There is no daemon, no build step, and no framework — just conventions that Claude Code already supports.

```
User prompt
    │
    ├── Hooks (PreToolUse, UserPromptSubmit) ── validate, guard, index
    │
    ├── Rules loaded from ~/.claude/rules/    ── behavior constraints
    │
    ├── AgentMemory context injected          ── cross-session knowledge
    │
Claude Code (main agent)
    │
    ├── /commands  ── orchestrate multi-step workflows
    ├── Skills     ── domain-specific playbooks invoked by description match
    └── Agents     ── subagents spawned for specialized work
            │
            └── Hooks (PostToolUse, Stop, SessionEnd) ── learn, verify, notify
```

Rules constrain behavior. Skills provide playbooks. Agents provide specialized execution. Hooks close the loop by persisting memory and enforcing invariants. Mission Control gives visibility into the whole system.
