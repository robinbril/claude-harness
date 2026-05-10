# /docs — Documentation, References & Help

One command for all documentation: auto-generate docs, Microsoft stack reference, Claude Code/Desktop config help, and OData reference.

## Modes

Detect the mode from the user's input:

- `/docs [path]` → **Auto-generate** documentation for code at path
- `/docs` → **Auto-generate** docs for current project
- `/docs ms [service]` → **Microsoft stack** reference (D365, Graph, Azure, Dataverse)
- `/docs claude` → **Claude Code/Desktop** configuration reference
- `/docs odata [entity]` → **OData entity** reference with query examples

---

## MODE: Auto-Generate Documentation (default)

### 1. Analyze Target

Read all source files in the target:
- Python: `*.py` (skip `__pycache__`, `.venv`)
- TypeScript: `*.ts` (skip `node_modules`)
- YAML: agent/plugin definitions

Extract:
- Tool/function signatures + docstrings
- Pydantic models (request/response schemas)
- Config patterns (env vars, settings)
- Error handling patterns
- Auth methods

### 2. Generate README.md

```markdown
# [Server/Agent Name]

[One-paragraph description]

## Quick Start

[How to run locally — uv sync, uvicorn, tilt up]

## Configuration

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|

## Tools / Endpoints

### [tool_name]
**Description:** [from docstring]
**Parameters:**
| Name | Type | Required | Description |
**Response:** [JSON example]
**Example:** [Python code]

## Architecture
[Mermaid diagram of data flow]

## Deployment
[Docker, Tilt, K8s instructions]

## Error Handling
[Error codes and resolutions table]

## Testing
[How to run tests]
```

### 3. Generate API Reference (MCP servers)

For each tool:
- Full signature with types
- Request/response examples
- Error codes
- Pagination patterns

### 4. Present & Offer to Write

Show generated docs and offer to write to `README.md`.

---

## MODE: Microsoft Stack Reference (`/docs ms [service]`)

### Services

#### `/docs ms fo` or `/docs ms d365`
```
D365 FINANCE & OPERATIONS
==========================
Endpoint: https://{env}.sandbox.operations.eu.dynamics.com/data/
Auth:     MSAL client_credentials → {url}/.default
SDK:      httpx + msal (raw OData v4, no SDK)

Key Entities:
  VendorsV2                          | VendorAccountNumber
  PurchaseOrderHeadersV2             | PurchaseOrderNumber
  PurchaseOrderLinesV2               | PurchaseOrderNumber + LineNumber
  SalesOrderHeadersV2                | SalesOrderNumber
  ReleasedProductsV2                 | ItemNumber + DataAreaId
  InboundLoadHeaders                 | LoadId
  InboundShipmentHeaders             | ShipmentId
  InboundLoadPackingStructures       | LicensePlateNumber
  InboundLoadPackingStructureLinesV3 | 13-field compound key

Gotchas:
  - contains() NOT on all entities → use startswith() or exact match
  - UnitSymbol must be lowercase (ea, not EA)
  - InboundLoadHeaders only needs LoadId for POST
  - Cascade delete: Lines → PackingStructures → Shipments → Header
  - Date format: datetime'YYYY-MM-DDTHH:MM:SS'
  - Enum values: use Microsoft.Dynamics.DataEntities.[Type]'[Value]'

Known sandboxes (fill in for your tenant):
  - Demo: <tenant>-demo.sandbox.operations.<region>.dynamics.com
  - Test: <tenant>-test.sandbox.operations.<region>.dynamics.com
```

Read SDK skills for more:
- `~/.claude/projects/.../memory/mcp-development.md`

#### `/docs ms bc`
```
D365 BUSINESS CENTRAL
======================
Endpoint: https://api.businesscentral.dynamics.com/v2.0/{tenant}/{env}/api/v2.0/
Auth:     OAuth2 client_credentials
SDK:      httpx + msal

Entities: currency, customer, item, salesOrder, salesQuote, vendor
Schemas:  bc_entities/, bc_custom_entities/, bc_actions/
```

#### `/docs ms graph`
```
MICROSOFT GRAPH API
====================
Endpoint: https://graph.microsoft.com/v1.0/
Auth:     DefaultAzureCredential or MSAL → graph.microsoft.com/.default
SDK:      msgraph-sdk (Python) or @microsoft/microsoft-graph-client (TS)

Common:
  /users/{id}/messages          Mail
  /users/{id}/calendar/events   Calendar
  /sites/{id}/drives/{id}/items SharePoint
  /teams/{id}/channels          Teams

Permissions: Application (daemon) or Delegated (user context)
```

Read: any project-local `m365-agents-py/SKILL.md` if your repo has one.

#### `/docs ms azure`
```
AZURE SERVICES
===============
Auth:    DefaultAzureCredential (ALWAYS preferred)
KV:      azure-keyvault-secrets → SecretClient
Search:  azure-search-documents → SearchClient
Blob:    azure-storage-blob → BlobServiceClient
Identity: azure-identity → DefaultAzureCredential
```

Read SDK skills:
- `azure-identity-py/SKILL.md`
- `azure-keyvault-py/SKILL.md`
- `azure-search-documents-py/SKILL.md`

#### `/docs ms ce` or `/docs ms dataverse`
```
D365 CE / DATAVERSE
====================
Endpoint: https://{org}.api.crm4.dynamics.com/api/data/v9.2/
Auth:     OAuth2 → {org}.crm4.dynamics.com/.default
SDK:      httpx + msal

Entities: contacts, accounts, opportunities, cases, leads
```

---

## MODE: Claude Config Reference (`/docs claude`)

### Current Setup

#### Claude Code (`~/.claude/settings.json`)
- Sandbox: disabled
- Plugin: everything-claude-code (enabled)
- Auto-updates: latest channel

#### Claude Desktop (`~/AppData/Roaming/Claude/claude_desktop_config.json`)
MCP servers: context7, microsoft-learn, d365-fo-mcp, dynamics365-ce, sequential-thinking, memory

#### Custom Commands (`~/.claude/commands/`)
- `/audit` — Code quality, security, performance
- `/debug` — MCP, D365, OData debugging
- `/build` — Generate MCP servers, agents, fix + test
- `/docs` — Documentation + references (this command)

#### Rules (`~/.claude/rules/`)
- common/ (9), python/ (5), typescript/ (5) = 19 rule files

### Common Tasks

| Task | How |
|------|-----|
| Add MCP to Claude Code (project) | `.mcp.json` → `mcpServers` |
| Add MCP to Claude Desktop | `claude_desktop_config.json` → `mcpServers` |
| Add custom command (global) | `~/.claude/commands/[name].md` |
| Add custom command (project) | `.claude/commands/[name].md` |
| Add skill | `.github/skills/[name]/SKILL.md` |
| Add plugin | `~/.claude/settings.json` → `enabledPlugins` |
| Check health | `/doctor` in CLI |
| Debug MCP | `/debug mcp [name]` |

---

## MODE: OData Entity Reference (`/docs odata [entity]`)

Read `~/.claude/projects/.../memory/mcp-development.md` for entity schemas.

For the requested entity, present:
- Full field list with types
- Key fields
- Supported operations (GET, POST, PATCH, DELETE)
- Filter functions that work (startswith, contains, eq, etc.)
- Related entities ($expand)
- Known gotchas
- Example queries (URL, cURL, Python)
- Example POST body (for create operations)
