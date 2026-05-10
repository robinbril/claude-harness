# /build — MCP Servers, Agents, Syntax Fixes & Tests

One command for all building: generate MCP servers, agent stacks, fix syntax errors, and run all tests.

## Gotchas
- Always use `from __future__ import annotations` in generated Python (avoids forward reference errors).
- FastMCP `@mcp.tool()` decorators must NOT include `timeout=` parameter directly (crashes on startup). Set timeout via `timeout=30.0` in the decorator kwargs instead.
- Starlette wrapper requires `lifespan=_mcp_app.lifespan` or the MCP session manager won't initialize.
- Generated code that uses `xml.etree.ElementTree` will fail with python-docx (uses lxml internally). Always use `lxml.etree`.
- Never generate `print()` statements. Use `logging.getLogger(__name__)` throughout.
- Plugin URLs must use the Container App name (e.g. `http://d365-fo-mcp:8000/mcp`), not localhost.

## Modes

Detect the mode from the user's input:

- `/build mcp [name] [description]` → **Generate MCP server** (zero-defect, full stack)
- `/build agent [name] [description]` → **Generate agent stack** (YAML + plugins + MCP)
- `/build fix [path]` → **Auto-fix syntax errors** in file or project
- `/build test [path]` → **Run all tests** + auto-fix failures
- `/build` → **Interactive** — ask what to build

---

## MODE: MCP Server (`/build mcp [name] [description]`)

Example: `/build mcp sharepoint-mcp "SharePoint documents via Graph API"`

### 1. Load Proven Patterns

Read your project's MCP/SDK reference files before generating. Typical sources:
1. The `mcp-builder` skill (`~/.claude/skills/mcp-builder/SKILL.md`) — generic MCP server patterns
2. Any project-specific skill describing your auth flow, framework conventions, and packaging layout
3. A working reference MCP server in your codebase (use it as a template for app.py / service.py structure)
4. Your project memory (`~/.claude/projects/<slug>/memory/mcp-development.md` if present)

### 2. Discovery (if not specified)

Ask the user:
1. Target API? (e.g. D365 F&O, BC, CE, Microsoft Graph, Azure DevOps, ARM, custom REST/GraphQL)
2. Operations? (read-only, read-write, CRUD)
3. Entities? (vendors, POs, documents, emails, work items, etc.)
4. Auth? (DefaultAzureCredential, MSAL client_credentials, OAuth on-behalf-of, API key)
5. Demo mode? (recommended: yes)

### 3. Generate Complete Stack

Create ALL these files in `tools/[name]/`:

```
tools/[name]/
├── src/[package_name]/        # snake_case of name
│   ├── __init__.py
│   ├── app.py                 # FastMCP + ToolError + annotations + lifespan + timeouts
│   ├── service.py             # Demo mode + live mode + MSAL + shared httpx + validation
│   └── models.py              # Pydantic v2 models (if needed)
├── tests/
│   ├── __init__.py
│   └── test_service.py        # Unit tests (demo mode), ≥80% coverage
├── fixtures/
│   └── [entity].json          # 10+ records, happy path + edge cases
├── pyproject.toml             # uv/hatch, locked deps
├── Dockerfile                 # python:3.11-slim + uv
├── Tiltfile                   # Live reload
├── manifests/
│   ├── deployment.yaml
│   └── service.yaml
└── README.md
```

#### app.py MANDATORY patterns:

```python
from __future__ import annotations
import logging
from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from fastmcp import FastMCP
from fastmcp.exceptions import ToolError
from .[service] import _reset_http_client, [all_impls]

logger = logging.getLogger(__name__)

@asynccontextmanager
async def _lifespan(app: FastMCP) -> AsyncIterator[None]:
    logger.info("[name] starting up")
    try:
        yield
    finally:
        logger.info("[name] shutting down")
        _reset_http_client()

mcp = FastMCP("[name]", instructions="...", lifespan=_lifespan)

@mcp.tool(
    annotations={"readOnlyHint": True, "destructiveHint": False,
                  "idempotentHint": True, "openWorldHint": True},
    tags={"[entity]", "search"}, timeout=30.0,
)
async def find_[entity](search_term: str, max_results: int = 20, offset: int = 0) -> dict:
    """Search for [entities] by name or ID."""
    try:
        return await find_[entity]_impl(search_term, max_results, offset)
    except Exception as exc:
        logger.exception("find_[entity] failed")
        raise ToolError(f"Failed: {str(exc)[:300]}") from exc

app = mcp.streamable_http_app()
```

#### service.py MANDATORY patterns:

```python
from __future__ import annotations
import json, logging, os, re, time
from pathlib import Path
from typing import Any
import httpx

_DEMO_MODE = os.getenv("[PREFIX]_DEMO", "true").lower() in ("1", "true", "yes")
_FIXTURES_DIR = Path(__file__).parent.parent.parent / "fixtures"

# Shared HTTP client (reuse, recreate if stale >5min)
_http_client: httpx.AsyncClient | None = None
_http_client_created: float = 0.0

def _get_http_client() -> httpx.AsyncClient: ...
def _reset_http_client() -> None: ...

# MSAL token cache
_token_cache: dict[str, Any] = {}
async def _get_token(config: dict[str, str]) -> str: ...

# Input validation
def _odata_escape(value: str, *, max_length: int = 200) -> str: ...
def clamp_pagination(offset: int, max_results: int, *, ceiling: int = 100) -> tuple[int, int]: ...

# Fixture loading
def _load_fixture(name: str) -> Any: ...

# Tool implementations — demo + live branches
async def find_[entity]_impl(search_term: str, max_results: int = 20, offset: int = 0, *, demo: bool | None = None) -> dict: ...
```

### 4. Validate Before Output

- [ ] Python syntax — all files parse without errors
- [ ] Import consistency — every name imported is defined
- [ ] Async/await — every I/O call awaited
- [ ] Type hints — all params + return types
- [ ] Pydantic v2 — `model_config` not `class Config`
- [ ] Naming — kebab service, snake package, snake tools
- [ ] No hardcoded secrets
- [ ] Pagination on all list tools

### 5. Present

```
MCP SERVER: [name] ✓
=====================
Files: [N] created
Tools: [list tool names]
Tests: [N] unit tests
Auth:  [method]
Demo:  [yes/no]

Next: cd tools/[name] && uv sync && uv run pytest -v
```

---

## MODE: Agent Stack (`/build agent [name] [description]`)

Example: `/build agent invoice-agent "Process invoices from email, validate against POs, create vendor invoices in D365"`

### 1. Load References

Read: hive-agent-builder SKILL.md, architecture.md, agents-reference.md, mcp-development.md
Study: inbound-load-agent.yaml, builder-agent.yaml (proven agents)

### 2. Discovery

Ask the user (skip answered):
1. Purpose? (one sentence)
2. Users? (warehouse, sales, support, dev)
3. Language? (Dutch/English/bilingual)
4. Microsoft services? (F&O, BC, CE, Graph, DevOps)
5. Operations per service? (read-only, read-write)
6. Workflow? (step-by-step)
7. Human approval steps?
8. Complexity? → model selection

### 3. Repo Scan

```bash
ls fellowmind.hiveai.demo.ville/agents/
ls fellowmind.hiveai.demo.ville/plugins/
ls fellowmind.hiveai.demo.ville/tools/
```

Reuse existing MCP servers where possible. Only build NEW ones for missing integrations.

### 4. Architecture → Present for Approval

```
Agent: [name]
  Model: [provider/model]
  Plugins:
    [plugin-1] → [mcp-server:port] (REUSE existing)
    [plugin-2] → [mcp-server:port] (NEW — needs building)
  Tools: [N] total
```

### 5. Generate

**Agent YAML** (`agents/[name].yaml`):
```yaml
kind: Agent
apiVersion: hive.fellowmind.io/v1alpha1
metadata:
  name: [name]
spec:
  agentCard:
    name: "[Human Name]"
    description: "[purpose]"
    version: "1.0.0"
    skills: [...]
  agent:
    type: "chat-completion"
    systemPrompt: |-
      # [Name]
      Je bent een gespecialiseerde AI-agent voor [purpose].

      ## Tools
      [per tool: name, description, when to use]

      ## Werkwijze
      [numbered steps]

      ## Bedrijfsregels
      - NOOIT automatisch goedkeuren zonder bevestiging
      - Bij confidence < 0.7: STOP en vraag verduidelijking

      ## Anti-Hallucinatie
      - Verzin NOOIT data, IDs, of namen
      - ALTIJD tools gebruiken voor informatie
    service:
      type: "anthropic"
      modelId: "claude-sonnet-4-20250514"
    plugins: [plugin_names]
```

**Plugin YAMLs** (only new):
```yaml
kind: Plugin
apiVersion: hive.fellowmind.io/v1alpha1
metadata:
  name: [name]
spec:
  type: "mcp"
  url: "http://[service]:8001/mcp"
```

**New MCP servers** → trigger `/build mcp` workflow for each.

### 6. Validate

- [ ] Agent YAML valid, all plugin refs exist
- [ ] Plugin URLs match K8s service names
- [ ] System prompt only references actual tools
- [ ] RFC 1123 naming
- [ ] Anti-hallucination + human approval in prompt

### 7. Present

```
AGENT STACK: [name] ✓
======================
Agent:   [name] ([model])
Plugins: [N] ([N] reused, [N] new)
Tools:   [N] total
Prompt:  [N] lines

Wiring:
  [agent] → [plugin] → [mcp:port] → [API]

Next:
  1. Review system prompt
  2. cd tools/[new-mcp] && uv sync && pytest -v
  3. tilt up
  4. Test in Apiary: http://localhost:5173
```

---

## MODE: Fix Syntax (`/build fix [path]`)

### 1. Detect Errors

#### Python
- `python -m py_compile [file]` / `ast.parse()`
- Import resolution
- Async/await correctness
- f-string brace matching
- Parentheses/bracket balance
- Indentation consistency

#### TypeScript
- `tsc --noEmit`
- Import resolution
- Missing null checks

### 2. Auto-Fix

For each error:
1. Read file → identify issue → apply Edit → verify no new errors

Common auto-fixes:
- Missing `await`, missing imports, indentation, unmatched quotes/brackets
- `Optional[str]` → `str | None`
- `class Config:` → `model_config = ConfigDict(...)`
- `print()` → `logger.info()`

### 3. Report

```
SYNTAX FIX: [N] errors found, [N] fixed
  [file:line] [error] → [fix]
```

---

## MODE: Run Tests (`/build test [path]`)

### 1. Discover

- Python: `**/test_*.py` (pytest)
- TypeScript: `**/*.test.ts` (vitest/jest)

### 2. Run

```bash
uv run pytest tests/ -v --tb=short
```

### 3. Analyze & Fix Failures

For each failure:
- Is it a test bug or source bug?
- Apply fix → re-run → verify

### 4. Report

```
TESTS: [N] passed, [N] failed, [N] fixed
Duration: [X.XX]s
Coverage gaps: [untested functions]
```
