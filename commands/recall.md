---
name: recall
description: Search agentmemory for cross-session knowledge (projects, clients, decisions, patterns)
---

# /recall - Cross-Session Memory Search

Search agentmemory's persistent knowledge graph for information from past sessions. This gives you instant access to project context, client details, architectural decisions, and learned patterns from any previous conversation.

## Usage

`/recall <query>` - search for anything across all sessions and projects

## Examples

- `/recall sales order agent` - find all context about a specific project
- `/recall how to deploy to AKS` - find deployment procedures
- `/recall contract search auth` - find auth setup for a project
- `/recall what did I work on last week` - recent activity summary
- `/recall project stakeholders` - find named people on a project

## Process

### 1. Smart Search

Use the `memory_smart_search` MCP tool with the user's query. This runs hybrid BM25 + vector search with knowledge graph traversal.

```
memory_smart_search({ query: "<user query>", limit: 10 })
```

### 2. Context Enrichment

If the query mentions a specific project, also fetch the project profile:

```
memory_recall({ query: "project:<project_name>", limit: 5 })
```

### 3. Present Results

Format the results clearly:

```
Recall Results
---
Found N relevant memories across M sessions

[Type] Title
  Content summary (first 200 chars)
  Source: session/migration | Date | Confidence

[Type] Title
  ...
```

### 4. Follow-up

If the user wants more detail on a specific result, use `memory_recall` with a more targeted query or fetch the full memory by ID.

## When agentmemory is not running

If the server at http://localhost:3111 is not reachable, fall back to:
1. Search local memory files in `~/.claude/projects/*/memory/`
2. Search MEMORY.md indexes
3. Suggest starting agentmemory: `agentmemory --tools all`
