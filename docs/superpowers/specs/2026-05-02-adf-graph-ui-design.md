# adf-graph-ui Design Spec

**Date:** 2026-05-02
**Status:** Approved
**Scope:** New sister repo for interactive visualization of adf-graph data

## Overview

A standalone web application that visualizes and explores the dependency graph built by adf-graph. Targets power users who already understand ADF pipelines and use adf-graph via Claude/MCP. The tool provides a full-graph overview with interactive drill-down, backed by the same MCP tools that power the CLI experience.

## Audience

Power users — developers and data engineers who work with ADF pipelines daily and already use adf-graph's MCP tools through Claude. The UI supplements CLI exploration with spatial overview, visual impact analysis, and quick node inspection.

## Architecture

Two repos, one protocol:

```
┌─────────────────────────┐         ┌──────────────────────────────────┐
│   adf-graph (existing)  │  stdio  │      adf-graph-ui (new repo)     │
│                         │◄───────►│                                  │
│  MCP Server             │   MCP   │  Backend (Node/Express)          │
│  Graph Builder          │ protocol│  ├─ Spawns adf-graph child proc  │
│  33 existing tools      │         │  ├─ MCP client (stdio transport) │
│  + graph_export (NEW)   │         │  ├─ REST API proxy               │
│                         │         │  └─ Serves static frontend       │
│                         │         │                                  │
│                         │         │  Frontend (SPA)                  │
│                         │         │  ├─ Cytoscape.js graph rendering │
│                         │         │  ├─ Search / filter toolbar      │
│                         │         │  ├─ Node detail inspector        │
│                         │         │  └─ Interactive query overlays   │
└─────────────────────────┘         └──────────────────────────────────┘
```

**Data flow:**
1. Server starts → spawns adf-graph as child process
2. Calls `graph_export` → caches full graph JSON in memory
3. Browser loads → fetches graph from `GET /api/graph`
4. Cytoscape.js renders the overview
5. User clicks node → inspector populates
6. User triggers query (impact, lineage, validate) → frontend calls `POST /api/tool` → backend proxies to MCP → result renders as overlay on graph

## Changes to adf-graph

One new MCP tool: `graph_export`.

**Input:**
```typescript
{ environment?: string }  // defaults to the default environment
```

**Output:**
```typescript
{
  environment: string,
  exportedAt: string,           // ISO timestamp
  stats: {
    nodeCount: number,
    edgeCount: number,
    nodesByType: Record<string, number>,
    edgesByType: Record<string, number>
  },
  nodes: Array<{
    id: string,                 // e.g. "pipeline:MyPipeline"
    type: string,               // "pipeline" | "activity" | "table" | ...
    name: string,
    metadata: Record<string, unknown>
  }>,
  edges: Array<{
    from: string,
    to: string,
    type: string,               // "executes" | "reads_from" | ...
    metadata: Record<string, unknown>
  }>
}
```

This is a flat serialization of the `Graph` object — all nodes and all edges in a single payload. ADF factory graphs are in the hundreds-to-low-thousands of nodes, well within a single JSON response.

## Backend Design

**Tech:** Node, Express, TypeScript, `@modelcontextprotocol/sdk`

**Startup sequence:**
1. Read config to find adf-graph binary path (or use `npx adf-graph`)
2. Spawn adf-graph as child process
3. Connect as MCP client over stdio
4. Call `graph_export`, cache result in memory
5. Start Express server, serve static frontend

**REST API — 3 endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/graph` | Returns cached graph_export JSON. `?refresh=true` re-fetches from adf-graph. |
| `POST` | `/api/tool` | Generic MCP proxy. Body: `{ tool: string, args: object }`. Returns tool result JSON. |
| `GET` | `/api/environments` | Proxies `graph_list_environments` (future environment switching). |

No database, no auth, no sessions. The backend holds one piece of state: the MCP client connection.

**Configuration:**
```bash
adf-graph-ui --adf-graph-path /path/to/adf-graph
# or
adf-graph-ui --npx    # uses npx adf-graph
```

The adf-graph child process inherits the parent's environment variables (`ADF_CONFIG`, `ADF_ROOT`), so existing configuration works without changes.

## Frontend Design

### Layout

Three zones plus a status bar:

**Top toolbar:**
- Search bar with fuzzy node search
- Type filter toggles (Pipelines, Tables, SPs, Datasets, Entities) — click to show/hide node types
- Refresh button to re-fetch graph from adf-graph

**Center canvas (Cytoscape.js):**
- Full graph overview with pan/zoom
- Nodes color-coded by type:
  - Blue: pipeline
  - Purple: stored_procedure
  - Green: table
  - Gold: dataverse_entity
  - Pink: dataset
  - Gray: linked_service, key_vault_secret
- Click a node to select and populate the inspector
- Edges show relationship direction; visual style varies by edge type
- Legend in bottom-left, zoom controls in bottom-right

**Right panel (Inspector):**
- Selected node's name, type, and direct connections (incoming/outgoing edges)
- Metadata display (column mappings, SQL queries, parameters) when available
- Action buttons triggering MCP tool calls:
  - Impact Analysis
  - Data Lineage
  - Validate

**Status bar:**
- Node/edge counts
- Current environment name
- Connection status indicator

### Graph Layout

Default: Cytoscape's `dagre` layout (hierarchical left-to-right) — suits pipeline DAGs naturally. User can toggle to `cose` (force-directed) for exploring dense clusters.

### Interactive Queries

MCP tool results render as visual overlays on the existing graph — no page navigation, no separate views. The graph stays, with different lenses applied.

**Impact Analysis** (node → "Impact Analysis"):
- Calls `graph_impact_analysis` with `direction: "both"`
- Upstream nodes highlighted warm (orange), downstream cool (blue)
- Edges in impact path become bold/bright
- Unaffected nodes fade to ~20% opacity
- Inspector shows affected node list with depths
- "Clear" button resets highlights

**Data Lineage** (node → "Data Lineage"):
- Calls `graph_data_lineage`
- Highlights lineage path on graph step by step
- Column mappings appear as edge annotations or in inspector detail
- Multiple paths shown with distinct visual styles

**Validate** (node → "Validate" or toolbar → "Validate All"):
- Calls `graph_validate` or `graph_validate_pipeline`
- Nodes with errors get red badge, warnings get yellow
- Inspector shows issue list grouped by severity
- Click an issue to focus graph on that node

**Search:**
- Calls `graph_search` via backend
- Matching nodes pulse/highlight; graph pans to center on results
- Non-matching nodes fade

## Project Structure

```
adf-graph-ui/
├── package.json
├── tsconfig.json
├── vite.config.ts
├── src/
│   ├── server/
│   │   ├── index.ts           # Express entry point
│   │   ├── mcp-client.ts      # Spawn adf-graph, MCP stdio transport
│   │   └── api.ts             # REST routes (/api/graph, /api/tool, /api/environments)
│   └── client/
│       ├── index.html          # SPA shell
│       ├── main.ts             # App bootstrap, fetch graph, init Cytoscape
│       ├── graph/
│       │   ├── renderer.ts     # Cytoscape setup, styling, layout config
│       │   ├── interactions.ts  # Click, hover, select handlers
│       │   └── overlays.ts     # Impact/lineage/validation highlight logic
│       ├── panels/
│       │   ├── toolbar.ts      # Search, filters, refresh
│       │   └── inspector.ts    # Right panel detail view
│       ├── api.ts              # Fetch wrapper for /api/* calls
│       └── styles.css          # Dark theme
```

## Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Backend | Node + Express + TypeScript | Matches adf-graph stack |
| MCP client | `@modelcontextprotocol/sdk` | Same SDK used by adf-graph |
| Frontend | Vanilla TypeScript | No framework needed — graph canvas + two panels |
| Graph rendering | Cytoscape.js | Purpose-built for network graph visualization |
| Graph layout | dagre (default), cose (toggle) | Hierarchical DAG suits pipeline structures |
| Bundler | Vite | Fast dev server + production build |
| Styling | CSS (dark theme) | Single theme, power-user audience |

## Dev Experience

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server (frontend HMR) + nodemon (backend reload) |
| `npm run build` | Vite bundles frontend, tsc compiles backend |
| `npm start` | Runs production server |
| `npm test` | Vitest |

## Scope — v1 Boundaries

**In scope:**
- Single environment visualization
- Full graph overview with pan/zoom
- Node type filtering and search
- Node inspector with metadata display
- Interactive impact analysis, data lineage, and validation overlays
- `graph_export` tool added to adf-graph

**Out of scope (future):**
- Multi-environment switching/comparison
- Side-by-side environment diffs
- Overlay management from the UI
- Pipeline activity DAG expansion (showing internal activity structure)
- Parameter tracing visualization
- VS Code extension wrapper
- Authentication / multi-user support

## Repo Setup

- New GitHub repo: `HurleySk/adf-graph-ui`
- Located at `C:/Users/shurley/source/repos/HurleySk/adf-graph-ui`
- Sister to `adf-graph` in the parent directory
- Peer dependency on `adf-graph` (installed globally or referenced by path)
