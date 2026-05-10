# /audit — Code Quality, Security, Performance & Deep Review

One command for all quality analysis: static analysis, security scanning, exhaustive code review, and performance profiling.

## Gotchas
- `git diff HEAD~5` fails on repos with fewer than 5 commits. Use `git log --oneline` first to check depth.
- Credential regex can false-positive on base64-encoded test fixtures and demo data. Check context before flagging.
- MCP server fixture files (e.g. `fixtures/*.json`) are expected to contain fake data. Don't flag demo API keys in fixture files.
- OneDrive paths with spaces need quoting in every command. Use double quotes around all paths.
- `pip audit` / `npm audit` require internet access and may fail behind corporate proxy.

## Modes

Detect the mode from the user's input:

- `/audit [path]` → **Full audit** (quality + security + performance) on target
- `/audit` → **Full audit** on recent git changes (`git diff HEAD~5`)
- `/audit security [path]` → **Security-only** deep scan
- `/audit perf [path]` → **Performance-only** analysis
- `/audit review [path]` → **Deep review** with concrete fixes

---

## MODE: Full Audit (default)

### 1. Identify Targets

If path given → audit that path.
If no path → `git diff HEAD~5 --name-only` to find recent changes.

Collect all source files:
- Python: `**/*.py` (exclude `__pycache__`, `.venv`, `node_modules`)
- TypeScript: `**/*.ts`, `**/*.tsx` (exclude `node_modules`, `dist`)
- Svelte: `**/*.svelte`
- YAML: `agents/*.yaml`, `plugins/*.yaml`, `manifests/*.yaml`

### 2. Static Analysis

#### Python
- [ ] Type hints on all function signatures (params + return)
- [ ] No `Any` unless justified
- [ ] Pydantic v2 (`model_config`, not `class Config`)
- [ ] Black formatting (120 line-length)
- [ ] No bare `except:` — specific exceptions only
- [ ] No mutable default args (`def f(items=[])`)
- [ ] Async where I/O happens
- [ ] `str | None` syntax (not `Optional[str]`)
- [ ] Docstrings on public functions
- [ ] No `print()` — use `logging`
- [ ] No `# type: ignore` without explanation

#### TypeScript
- [ ] Strict mode (no `any`)
- [ ] Proper error handling (no empty catch)
- [ ] No `console.log` in production
- [ ] No `!` non-null assertions
- [ ] Consistent style (single quotes, no trailing commas)

#### MCP Servers
- [ ] All tools: clear, narrow descriptions
- [ ] All list tools: pagination (offset + max_results, default 20, max 100)
- [ ] Tool names: `{service}_{verb}_{resource}` snake_case
- [ ] Input validation with Pydantic
- [ ] ToolError for errors (not dict returns)
- [ ] Health endpoint
- [ ] No secrets in code/logs

### 3. Security Scan

#### Credential Detection (grep ALL files)
- `sk-` (OpenAI), `ghp_` (GitHub), `AKIA` (AWS), `-----BEGIN` (PEM)
- `password\s*=\s*["']`, `secret\s*=\s*["']`, `connection_string`
- `Bearer ` + long token, base64 strings >40 chars in config
- `.env` in `git ls-files`, `*.pem`/`*.key`/`*.pfx` in repo

#### Auth Patterns
- [ ] `DefaultAzureCredential` used (not hardcoded creds)
- [ ] Token caching with expiry
- [ ] No tokens in log output
- [ ] MSAL confidential client for servers
- [ ] Minimum required permissions/scopes

#### Input Validation
- [ ] OData injection prevention (string sanitization)
- [ ] Path traversal blocked (`../`)
- [ ] URL validation (whitelist, no SSRF)
- [ ] JSON validated with schemas
- [ ] Max request size limits

#### K8s Security
- [ ] No secrets in `env:` blocks (use secretRef)
- [ ] Network policies defined
- [ ] Minimal RBAC

### 4. Performance Analysis

#### N+1 Detection
Search for sequential API calls in loops:
```python
for item in items:
    result = await api_call(item.id)  # N+1!
```

#### Resource Management
- [ ] HTTP clients shared (not per-request)
- [ ] Connection pooling configured
- [ ] Timeouts on all I/O
- [ ] Caching with TTL + eviction
- [ ] Bounded collections (max size on caches/lists)

#### Async Correctness
- [ ] No blocking calls in async context (`time.sleep`, `requests.get`)
- [ ] `asyncio.gather()` for parallel I/O
- [ ] Proper `await` on all coroutines

#### Memory
- [ ] No unbounded growth (caches, lists, dicts)
- [ ] Connections closed (httpx, database)
- [ ] Event listeners removed

### 5. Deep Review (Architecture + Edge Cases)

#### Architecture
- Single Responsibility: each function/class does one thing
- Dependency direction: domain > infrastructure
- Error propagation: handled at right layer
- Coupling: modules testable in isolation
- DRY: no duplicated logic

#### Edge Cases (per function)
- `None`/`null` inputs
- Empty strings, empty lists, zero values
- Extremely large inputs (100K+ items)
- Concurrent calls (race conditions)
- External services down
- Malformed data (invalid JSON, wrong types)

### 6. Present Full Audit Report

```
FULL AUDIT REPORT
==================
Scope:    [path or git diff]
Files:    [N] scanned
Time:     [timestamp]

SCORE: [X/100]

╔══════════════════════════════════════════════╗
║  CRITICAL  [N]  │  HIGH  [N]  │  MEDIUM [N] ║
╚══════════════════════════════════════════════╝

CRITICAL:
  [C1] [file:line] [issue]
       Impact: [what breaks]
       Fix:
       ```[lang]
       [code fix]
       ```

HIGH:
  [H1] [file:line] [issue]
       Fix: [solution]

MEDIUM:
  [M1] [file:line] [issue]

SECURITY: [PASS/FAIL]
  Credentials found:  [N]
  Auth pattern:       [Managed Identity / hardcoded / missing]
  Input validation:   [N/M] endpoints covered
  Dependencies:       [N] vulnerable

PERFORMANCE: [GOOD/NEEDS WORK/CRITICAL]
  N+1 queries:        [N] found
  HTTP clients:       [shared/per-request]
  Caching:            [present with TTL / absent / unbounded]
  Async correctness:  [N] issues

STANDARDS: [N/M] org standards checks passed
  Naming:     [✓/✗]
  Security:   [✓/✗]
  MCP:        [✓/✗]
  Packaging:  [✓/✗]

TEST GAPS:
  - [untested scenario]
  - [missing edge case test]

TOP 5 ACTIONS:
  1. [highest priority — with file:line + fix]
  2. [second priority]
  3. [third priority]
  4. [fourth priority]
  5. [fifth priority]
```

---

## MODE: Security Only (`/audit security`)

Run only steps 3 (Security Scan) with extra depth:
- Full `git ls-files` scan for tracked secrets
- Dependency audit (`pip audit` / `npm audit`)
- OWASP Top 10 assessment
- Zero Trust readiness evaluation

Present compact security-focused report.

---

## MODE: Performance Only (`/audit perf`)

Run only step 4 (Performance Analysis) with extra depth:
- Connection pool sizing
- Estimated concurrent user capacity
- Bottleneck identification
- Scalability recommendations (what to change for 10x)

---

## MODE: Deep Review (`/audit review`)

Run only step 5 (Architecture + Edge Cases) with extra depth:
- Read all related files (imports, types, tests)
- Provide concrete code fixes for every finding (not just descriptions)
- Suggest specific test cases to add
- Architectural improvement recommendations
