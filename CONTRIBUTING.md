# Contributing

Thanks for considering a contribution. This repo is the harness that imports rules, commands, skills, and agents into a Claude Code setup. Keep changes small, focused, and easy to review.

## Dev setup

```bash
git clone https://github.com/robinbril/claude-harness.git
cd claude-harness
node import.mjs --dry-run   # preview what would be imported
node import.mjs             # apply
```

Node 18+ is required. No other build step.

## Project layout

```
rules/             Reusable rule snippets (common, typescript, python, golang)
commands/          Slash commands (one .md per command)
skills/            Domain skills (one directory per skill, with SKILL.md)
agents/            Subagents (one .md per agent, with frontmatter)
scripts/           Helper scripts used by commands/skills
session-browser/   Mission Control UI for browsing sessions
config/            Settings, hooks, keybindings
templates/         Scaffolding for new commands/skills/agents
import.mjs         Importer that wires everything into ~/.claude
```

## Adding a slash command

Drop a `.md` file in `commands/` with frontmatter:

```markdown
---
name: my-command
description: One-line description shown in the command picker
---

Command body goes here.
```

## Adding a skill

Create a directory in `skills/<skill-name>/` containing `SKILL.md`. Optional helper scripts live alongside.

```
skills/my-skill/
  SKILL.md
  helper.py        # optional
```

The `SKILL.md` description controls when the skill triggers. Be specific.

## Adding an agent

Drop a `.md` file in `agents/` with frontmatter for model and tools:

```markdown
---
name: my-agent
model: claude-sonnet-4-6
tools: [Read, Edit, Bash]
description: What this agent does and when to use it
---

System prompt for the agent.
```

## PR process

1. Fork, branch off `main` (`feat/...`, `fix/...`, `docs/...`).
2. Keep commits descriptive. Use conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`).
3. No AI slop in commit messages — no "comprehensive", no "robust", no marketing.
4. Sanitize any company-specific data, paths, or secrets before pushing.
5. Open a PR using the template.

## Testing

```bash
node import.mjs --dry-run                  # importer smoke test
cd session-browser && npm install && npm start   # verify Mission Control loads
```

Run both before requesting review.
