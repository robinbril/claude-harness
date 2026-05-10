# /debug — MCP, D365, OData & Integration Debugging

One command for all debugging: MCP server connectivity, D365 F&O/BC OData issues, Graph API problems, OData query building, and general integration diagnostics.

## Modes

Detect the mode from the user's input:

- `/debug` → **Auto-detect** — analyze errors in current context
- `/debug mcp [server-name]` → **MCP server** diagnostics
- `/debug d365` → **D365 F&O/BC** OData + auth troubleshooting
- `/debug odata [entity] [operation]` → **OData query** builder + validator
- `/debug graph` → **Graph API** diagnostics

---

## MODE: Auto-Detect (default)

Look at the current context for clues:
- Recent error messages in conversation → diagnose that
- If in an MCP server directory → run MCP diagnostics
- If D365-related files open → run D365 diagnostics
- If no context → ask the user what's broken

---

## MODE: MCP Server (`/debug mcp [name]`)

### 1. Identify Servers

Read MCP configs from:
- `~/AppData/Roaming/Claude/claude_desktop_config.json` (Claude Desktop)
- `.mcp.json` or `.claude.json` (project level)
- `~/.claude/settings.json` (global)

List all `mcpServers` with type (http/stdio/sse) and URL/command.

### 2. Connectivity

#### HTTP/SSE servers
- `curl -s [url]` — reachable?
- `curl -s [url]/health` or `curl -s [url]/mcp` — MCP endpoint?
- Port check: `netstat -an | findstr [port]` (Windows) or `lsof -i :[port]` (Mac/Linux)
- If Tilt: `http://localhost:10350` pod status

#### Stdio servers
- `where [command]` / `which [command]` — binary exists?
- `[command] --version` — runs?
- If npx: `npx -y [package] --version`

### 3. Tool Discovery

```bash
curl -X POST [url]/mcp -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

- Valid JSON-RPC response?
- Expected tools listed?
- Tool descriptions match?

### 4. Common MCP Issues Checklist

- [ ] Port conflict (another process on same port)
- [ ] Python venv not activated / deps not installed
- [ ] Wrong Python/Node version
- [ ] Firewall/proxy blocking
- [ ] SSL certificate issues
- [ ] Missing env vars (API keys, URLs)
- [ ] JSON-RPC version mismatch
- [ ] Timeout too short for cold start

### 5. Present

```
MCP DEBUG: [name]
=================
Type:          [http/stdio/sse]
URL:           [endpoint]
Connectivity:  [✓ OK / ✗ FAILED — reason]
MCP endpoint:  [✓ OK / ✗ FAILED]
Tools:         [N discovered / failed]
Auth:          [OK / FAILED — error]

Issues:
  1. [issue] → Fix: [solution]
  2. [issue] → Fix: [solution]

Quick fixes:
  [concrete commands to run]
```

---

## MODE: D365 (`/debug d365`)

### 1. Identify Environment

Read config for `FO_API_URL`, `FO_TENANT_ID`, `FO_CLIENT_ID`.

List your known D365 F&O environments here, e.g.:
- Demo: `<tenant>-demo.sandbox.operations.<region>.dynamics.com`
- Test: `<tenant>-test.sandbox.operations.<region>.dynamics.com`

### 2. Auth Diagnostics

Test MSAL token acquisition:
```python
import msal
app = msal.ConfidentialClientApplication(
    client_id,
    authority=f"https://login.microsoftonline.com/{tenant_id}",
    client_credential=client_secret,
)
result = app.acquire_token_for_client(scopes=[f"{fo_url}/.default"])
```

Common errors:
- `AADSTS700016` → App not found (wrong tenant)
- `AADSTS7000215` → Secret expired or wrong
- `AADSTS65001` → No admin consent
- `AADSTS50126` → Invalid credentials

### 3. Entity Validation

Test key entities:
```
GET {url}/data/$metadata               → XML response
GET {url}/data/VendorsV2?$top=1        → vendor data
GET {url}/data/PurchaseOrderHeadersV2?$top=1
GET {url}/data/InboundLoadHeaders?$top=1
```

### 4. Common D365 Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| 404 on entity | Wrong entity name or not enabled | Check `$metadata`, enable in Feature Management |
| `contains()` fails | Not supported on all entities | Use `startswith()` or exact match + client filter |
| 400 on filter | Wrong date format or enum | Use `datetime'...'` format, numeric enums |
| 403 Forbidden | App user missing role | Add System Administrator to app user in D365 |
| UnitSymbol error | Case sensitivity | Use lowercase: `ea`, not `EA` |
| Compound key 404 | Missing key fields | All key fields required for read/update/delete |
| Delete cascade fail | Wrong order | Lines → PackingStructures → Shipments → Header |

### 5. Present

```
D365 DEBUG
==========
Environment: [url]
Tenant:      [id]
App:         [client_id]

Auth:    [✓ Token acquired / ✗ Failed — AADSTS code]
Expiry:  [timestamp]

Entities:
  VendorsV2:                     [✓/✗ status]
  PurchaseOrderHeadersV2:        [✓/✗]
  InboundLoadHeaders:            [✓/✗]
  InboundShipmentHeaders:        [✓/✗]
  InboundLoadPackingStructures:  [✓/✗]

Issues:
  1. [issue] → [fix]

Health: [sandbox available / maintenance]
```

---

## MODE: OData Query Builder (`/debug odata [entity] [operation]`)

### 1. Entity Reference

| Entity | Key | Gotchas |
|--------|-----|---------|
| VendorsV2 | VendorAccountNumber | No `contains()`, use `startswith()` |
| PurchaseOrderHeadersV2 | PurchaseOrderNumber | Filter: OrderVendorAccountNumber |
| PurchaseOrderLinesV2 | PurchaseOrderNumber+LineNumber | Compound key |
| SalesOrderHeadersV2 | SalesOrderNumber | |
| ReleasedProductsV2 | ItemNumber+DataAreaId | Compound key |
| InboundLoadHeaders | LoadId | Only needs LoadId on POST |
| InboundShipmentHeaders | ShipmentId | |
| InboundLoadPackingStructures | LicensePlateNumber | |
| InboundLoadPackingStructureLinesV3 | 13 fields | Cascade delete order |

### 2. Build Query

Construct the full query with:
- Correct `$filter` syntax (escape strings, use right functions)
- `$select` for needed fields only
- `$top` + `$skip` for pagination
- `$expand` for related entities
- `$orderby` for sorting

### 3. Validate

- [ ] Entity name exists and is case-correct
- [ ] All field names valid
- [ ] String values in single quotes
- [ ] No unsupported functions for entity
- [ ] Pagination present
- [ ] Date format correct (`datetime'...'`)

### 4. Present

```
ODATA QUERY: [entity] [operation]
==================================

URL:
  GET {base}/data/[Entity]?$filter=...&$select=...&$top=20

cURL:
  curl -H "Authorization: Bearer {token}" "[url]"

Python:
  resp = await client.get(f"{base}/data/[Entity]", params={...})

Response shape:
  {"@odata.context":"...","value":[{...}]}

Warnings:
  - [entity-specific gotcha]
```

---

## MODE: Graph API (`/debug graph`)

### 1. Check Config

- `GRAPH_TENANT_ID`, `GRAPH_CLIENT_ID`, `GRAPH_CLIENT_SECRET`
- App Registration permissions (Application vs Delegated)
- Admin consent status

### 2. Common Graph Issues

- `401 Unauthorized` → Token expired or wrong scope
- `403 Forbidden` → Missing permission or no admin consent
- `404 Not Found` → Wrong user/mailbox ID or resource path
- Rate limiting → Implement retry with exponential backoff
- Certificate expired → Rotate in App Registration

### 3. Present

```
GRAPH DEBUG
===========
Tenant:      [id]
App:         [client_id]
Permissions: [list granted permissions]
Auth:        [✓/✗]

Endpoints tested:
  /me:               [✓/✗]
  /users:            [✓/✗]
  /users/{id}/messages: [✓/✗]

Issues:
  1. [issue] → [fix]
```
