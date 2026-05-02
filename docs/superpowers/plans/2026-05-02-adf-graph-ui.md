# adf-graph-ui Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone web application that visualizes the adf-graph dependency graph using Cytoscape.js, backed by a thin Node/Express MCP proxy.

**Architecture:** Two repos — `adf-graph` gets a new `graph_export` MCP tool, `adf-graph-ui` is a new Node/Express + Cytoscape.js SPA that spawns adf-graph as a child process, fetches the full graph via MCP, and proxies interactive queries. Use the `frontend-design:frontend-design` skill for all frontend/UI implementation tasks.

**Tech Stack:** Node 18+, Express, TypeScript (ES modules), Vite, Cytoscape.js, `@modelcontextprotocol/sdk`, vitest

---

## File Structure

### adf-graph (existing repo — one new file, one modified)

| File | Action | Responsibility |
|------|--------|----------------|
| `src/tools/export.ts` | Create | `handleExport` — serializes full Graph to JSON |
| `src/registerTools.ts` | Modify | Register `graph_export` tool |
| `tests/tools/export.test.ts` | Create | Tests for handleExport |

### adf-graph-ui (new repo)

| File | Action | Responsibility |
|------|--------|----------------|
| `package.json` | Create | Project metadata, dependencies, scripts |
| `tsconfig.json` | Create | TypeScript config (matches adf-graph conventions) |
| `tsconfig.server.json` | Create | Server-only TS config (compiles to dist/) |
| `vite.config.ts` | Create | Vite config for client bundle |
| `.gitignore` | Create | Standard Node + dist ignores |
| `src/server/index.ts` | Create | Express entry — start server, spawn MCP client, serve static |
| `src/server/mcp-client.ts` | Create | Spawn adf-graph child process, MCP stdio client, tool call proxy |
| `src/server/api.ts` | Create | Express routes: `/api/graph`, `/api/tool`, `/api/environments` |
| `src/client/index.html` | Create | SPA shell — toolbar, canvas, inspector, status bar |
| `src/client/main.ts` | Create | App bootstrap — fetch graph, init Cytoscape, wire panels |
| `src/client/graph/renderer.ts` | Create | Cytoscape init, node/edge styling, layout config |
| `src/client/graph/interactions.ts` | Create | Click/hover/select handlers, inspector updates |
| `src/client/graph/overlays.ts` | Create | Impact/lineage/validation highlight rendering |
| `src/client/panels/toolbar.ts` | Create | Search bar, type filters, refresh button |
| `src/client/panels/inspector.ts` | Create | Right panel — node detail, connections, action buttons |
| `src/client/api.ts` | Create | Fetch wrapper for `/api/*` endpoints |
| `src/client/styles.css` | Create | Dark theme styles |
| `tests/server/mcp-client.test.ts` | Create | MCP client spawn/connect tests |
| `tests/server/api.test.ts` | Create | API route tests |

---

## Task 1: Add `graph_export` tool to adf-graph

**Files:**
- Create: `src/tools/export.ts`
- Create: `tests/tools/export.test.ts`
- Modify: `src/registerTools.ts`

- [ ] **Step 1: Write the failing test for handleExport**

Create `tests/tools/export.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleExport } from "../../src/tools/export.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("handleExport", () => {
  it("returns all nodes and edges from the graph", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleExport(graph, "test-env");
    const stats = graph.stats();

    expect(result.environment).toBe("test-env");
    expect(result.exportedAt).toBeDefined();
    expect(result.stats.nodeCount).toBe(stats.nodeCount);
    expect(result.stats.edgeCount).toBe(stats.edgeCount);
    expect(result.nodes).toHaveLength(stats.nodeCount);
    expect(result.edges).toHaveLength(stats.edgeCount);
  });

  it("includes node id, type, name, and metadata", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleExport(graph, "test-env");
    const node = result.nodes[0];

    expect(node).toHaveProperty("id");
    expect(node).toHaveProperty("type");
    expect(node).toHaveProperty("name");
    expect(node).toHaveProperty("metadata");
  });

  it("includes edge from, to, type, and metadata", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleExport(graph, "test-env");
    const edge = result.edges[0];

    expect(edge).toHaveProperty("from");
    expect(edge).toHaveProperty("to");
    expect(edge).toHaveProperty("type");
    expect(edge).toHaveProperty("metadata");
  });

  it("includes stats grouped by type", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleExport(graph, "test-env");

    expect(result.stats.nodesByType).toBeDefined();
    expect(result.stats.edgesByType).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/tools/export.test.ts`
Expected: FAIL — `handleExport` does not exist

- [ ] **Step 3: Implement handleExport**

Create `src/tools/export.ts`:

```typescript
import { Graph, GraphNode, GraphEdge, GraphStats } from "../graph/model.js";

export interface ExportResult {
  environment: string;
  exportedAt: string;
  stats: GraphStats;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function handleExport(graph: Graph, environment: string): ExportResult {
  return {
    environment,
    exportedAt: new Date().toISOString(),
    stats: graph.stats(),
    nodes: graph.allNodes(),
    edges: graph.allEdges(),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/tools/export.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Register the tool in registerTools.ts**

Add import at top of `src/registerTools.ts`:

```typescript
import { handleExport } from "./tools/export.js";
```

Add tool registration inside `registerTools()`, after the stats tool block:

```typescript
server.tool(
  "graph_export",
  "Export the full graph (all nodes and edges) as a single JSON payload. Designed for visualization tools that need the complete topology.",
  { environment: environmentParam },
  async ({ environment }) => {
    const build = manager.ensureGraph(environment);
    const envName = environment ?? manager.getDefaultEnvironment();
    return json(handleExport(build.graph, envName));
  },
);
```

- [ ] **Step 6: Run full test suite**

Run: `npm test`
Expected: All tests pass, no regressions

- [ ] **Step 7: Build to verify compilation**

Run: `npm run build`
Expected: Clean build, no errors

- [ ] **Step 8: Commit**

```bash
git add src/tools/export.ts tests/tools/export.test.ts src/registerTools.ts
git commit -m "feat: add graph_export tool for visualization clients"
```

---

## Task 2: Scaffold adf-graph-ui repo

**Files:**
- Create: `../adf-graph-ui/package.json`
- Create: `../adf-graph-ui/tsconfig.json`
- Create: `../adf-graph-ui/tsconfig.server.json`
- Create: `../adf-graph-ui/vite.config.ts`
- Create: `../adf-graph-ui/.gitignore`

- [ ] **Step 1: Create directory and initialize git**

```bash
mkdir -p ../adf-graph-ui
cd ../adf-graph-ui
git init
```

- [ ] **Step 2: Create package.json**

Create `package.json`:

```json
{
  "name": "adf-graph-ui",
  "version": "0.1.0",
  "description": "Interactive visualization for adf-graph dependency graphs",
  "license": "MIT",
  "author": "HurleySk",
  "type": "module",
  "engines": { "node": ">=18" },
  "bin": { "adf-graph-ui": "dist/server/index.js" },
  "scripts": {
    "dev": "concurrently \"vite\" \"tsc -p tsconfig.server.json --watch\"",
    "build": "vite build && tsc -p tsconfig.server.json",
    "start": "node dist/server/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "express": "^5.1.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.0.0",
    "concurrently": "^9.1.0",
    "cytoscape": "^3.31.0",
    "cytoscape-dagre": "^2.5.0",
    "typescript": "^5.5.0",
    "vite": "^6.3.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json (shared base)**

Create `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 4: Create tsconfig.server.json**

Create `tsconfig.server.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "dist/server",
    "rootDir": "src/server"
  },
  "include": ["src/server/**/*"]
}
```

- [ ] **Step 5: Create vite.config.ts**

Create `vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: "src/client",
  build: {
    outDir: resolve(__dirname, "dist/client"),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
```

- [ ] **Step 6: Create .gitignore**

Create `.gitignore`:

```
node_modules/
dist/
.superpowers/
*.tsbuildinfo
```

- [ ] **Step 7: Install dependencies**

```bash
npm install
```

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold adf-graph-ui project"
```

---

## Task 3: MCP client — spawn adf-graph and connect

**Files:**
- Create: `../adf-graph-ui/src/server/mcp-client.ts`
- Create: `../adf-graph-ui/tests/server/mcp-client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/mcp-client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdfGraphClient } from "../../src/server/mcp-client.js";

describe("AdfGraphClient", () => {
  it("constructs with a command path", () => {
    const client = new AdfGraphClient({ command: "adf-graph" });
    expect(client).toBeDefined();
  });

  it("constructs with npx mode", () => {
    const client = new AdfGraphClient({ npx: true });
    expect(client).toBeDefined();
  });

  it("callTool validates tool name is a string", async () => {
    const client = new AdfGraphClient({ command: "adf-graph" });
    await expect(client.callTool("", {})).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/mcp-client.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement AdfGraphClient**

Create `src/server/mcp-client.ts`:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface AdfGraphClientOptions {
  command?: string;
  npx?: boolean;
  env?: Record<string, string>;
}

export class AdfGraphClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private options: AdfGraphClientOptions;

  constructor(options: AdfGraphClientOptions) {
    if (!options.command && !options.npx) {
      throw new Error("Provide either command or npx option");
    }
    this.options = options;
  }

  async connect(): Promise<void> {
    const command = this.options.npx ? "npx" : this.options.command!;
    const args = this.options.npx ? ["adf-graph"] : [];

    this.transport = new StdioClientTransport({
      command,
      args,
      env: { ...process.env, ...this.options.env } as Record<string, string>,
    });

    this.client = new Client({ name: "adf-graph-ui", version: "0.1.0" });
    await this.client.connect(this.transport);
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!name) throw new Error("Tool name is required");
    if (!this.client) throw new Error("Not connected — call connect() first");

    const result = await this.client.callTool({ name, arguments: args });
    const textContent = result.content as Array<{ type: string; text: string }>;
    const text = textContent.find((c) => c.type === "text")?.text;
    if (!text) throw new Error(`Tool ${name} returned no text content`);
    return JSON.parse(text);
  }

  async disconnect(): Promise<void> {
    if (this.transport) {
      await this.transport.close();
      this.transport = null;
      this.client = null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/mcp-client.test.ts`
Expected: All 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/mcp-client.ts tests/server/mcp-client.test.ts
git commit -m "feat: add MCP client for spawning adf-graph"
```

---

## Task 4: Express API routes

**Files:**
- Create: `../adf-graph-ui/src/server/api.ts`
- Create: `../adf-graph-ui/tests/server/api.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/server/api.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createRouter } from "../../src/server/api.js";

const mockClient = {
  callTool: vi.fn(),
};

describe("createRouter", () => {
  it("returns an Express router", () => {
    const router = createRouter(mockClient as any, null);
    expect(router).toBeDefined();
    expect(typeof router).toBe("function");
  });
});

describe("GET /api/graph handler logic", () => {
  it("returns cached graph data", async () => {
    const graphData = {
      environment: "test",
      nodes: [{ id: "pipeline:P1", type: "pipeline", name: "P1", metadata: {} }],
      edges: [],
      stats: { nodeCount: 1, edgeCount: 0, nodesByType: {}, edgesByType: {} },
    };

    const router = createRouter(mockClient as any, graphData);
    expect(router).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/api.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement createRouter**

Create `src/server/api.ts`:

```typescript
import { Router, Request, Response } from "express";
import { AdfGraphClient } from "./mcp-client.js";

export function createRouter(client: AdfGraphClient, initialGraph: unknown): Router {
  const router = Router();
  let cachedGraph = initialGraph;

  router.get("/api/graph", async (_req: Request, res: Response) => {
    try {
      const refresh = _req.query.refresh === "true";
      if (refresh || !cachedGraph) {
        cachedGraph = await client.callTool("graph_export");
      }
      res.json(cachedGraph);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/api/tool", async (req: Request, res: Response) => {
    try {
      const { tool, args } = req.body;
      if (!tool || typeof tool !== "string") {
        res.status(400).json({ error: "Missing or invalid 'tool' field" });
        return;
      }
      const result = await client.callTool(tool, args ?? {});
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/api/environments", async (_req: Request, res: Response) => {
    try {
      const result = await client.callTool("graph_list_environments");
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/server/api.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/server/api.ts tests/server/api.test.ts
git commit -m "feat: add Express API routes for graph and tool proxy"
```

---

## Task 5: Express server entry point

**Files:**
- Create: `../adf-graph-ui/src/server/index.ts`

- [ ] **Step 1: Implement the server entry point**

Create `src/server/index.ts`:

```typescript
#!/usr/bin/env node
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import express from "express";
import { AdfGraphClient } from "./mcp-client.js";
import { createRouter } from "./api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const port = parseInt(process.env.PORT ?? "3000", 10);
const adfGraphPath = process.argv.includes("--npx")
  ? undefined
  : process.argv[process.argv.indexOf("--adf-graph-path") + 1] ?? "adf-graph";
const useNpx = process.argv.includes("--npx");

async function main() {
  console.log("Connecting to adf-graph...");
  const client = new AdfGraphClient({
    command: adfGraphPath,
    npx: useNpx,
  });
  await client.connect();

  console.log("Fetching initial graph...");
  const graph = await client.callTool("graph_export");

  const app = express();
  app.use(express.json());
  app.use(createRouter(client, graph));

  const clientDir = resolve(__dirname, "../client");
  app.use(express.static(clientDir));

  app.listen(port, () => {
    console.log(`adf-graph-ui running at http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error("Failed to start:", err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Verify server compiles**

Run: `npx tsc -p tsconfig.server.json --noEmit`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat: add Express server entry point"
```

---

## Task 6: Client API wrapper

**Files:**
- Create: `../adf-graph-ui/src/client/api.ts`

- [ ] **Step 1: Implement the fetch wrapper**

Create `src/client/api.ts`:

```typescript
export interface GraphExport {
  environment: string;
  exportedAt: string;
  stats: {
    nodeCount: number;
    edgeCount: number;
    nodesByType: Record<string, number>;
    edgesByType: Record<string, number>;
  };
  nodes: Array<{
    id: string;
    type: string;
    name: string;
    metadata: Record<string, unknown>;
  }>;
  edges: Array<{
    from: string;
    to: string;
    type: string;
    metadata: Record<string, unknown>;
  }>;
}

export async function fetchGraph(refresh = false): Promise<GraphExport> {
  const url = refresh ? "/api/graph?refresh=true" : "/api/graph";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch graph: ${res.statusText}`);
  return res.json();
}

export async function callTool(tool: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const res = await fetch("/api/tool", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool, args }),
  });
  if (!res.ok) throw new Error(`Tool call failed: ${res.statusText}`);
  return res.json();
}

export async function fetchEnvironments(): Promise<unknown> {
  const res = await fetch("/api/environments");
  if (!res.ok) throw new Error(`Failed to fetch environments: ${res.statusText}`);
  return res.json();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/api.ts
git commit -m "feat: add client-side API wrapper"
```

---

## Task 7: Cytoscape graph renderer

> **Note:** Use the `frontend-design:frontend-design` skill for this task.

**Files:**
- Create: `../adf-graph-ui/src/client/graph/renderer.ts`

- [ ] **Step 1: Implement the renderer**

Create `src/client/graph/renderer.ts`:

```typescript
import cytoscape, { Core, Stylesheet, LayoutOptions } from "cytoscape";
import dagre from "cytoscape-dagre";
import { GraphExport } from "../api.js";

cytoscape.use(dagre);

const NODE_COLORS: Record<string, string> = {
  pipeline: "#4a9eff",
  activity: "#8ac4ff",
  stored_procedure: "#c084fc",
  table: "#7dce82",
  dataverse_entity: "#e8b44a",
  dataverse_attribute: "#d4a03c",
  dataset: "#e8b4b8",
  linked_service: "#888",
  key_vault_secret: "#666",
};

const STYLE: Stylesheet[] = [
  {
    selector: "node",
    style: {
      label: "data(name)",
      "background-color": "data(color)",
      color: "#eee",
      "text-valign": "bottom",
      "text-margin-y": 6,
      "font-size": 10,
      width: 28,
      height: 28,
      "border-width": 2,
      "border-color": "data(color)",
      "background-opacity": 0.2,
      "text-max-width": "100px",
      "text-wrap": "ellipsis",
    },
  },
  {
    selector: "node:selected",
    style: {
      "border-width": 3,
      "background-opacity": 0.5,
      "font-weight": "bold",
    },
  },
  {
    selector: "node.faded",
    style: { opacity: 0.15 },
  },
  {
    selector: "node.highlighted-upstream",
    style: { "border-color": "#f97316", "border-width": 3, "background-opacity": 0.5 },
  },
  {
    selector: "node.highlighted-downstream",
    style: { "border-color": "#3b82f6", "border-width": 3, "background-opacity": 0.5 },
  },
  {
    selector: "node.error",
    style: { "border-color": "#ef4444", "border-width": 3 },
  },
  {
    selector: "node.warning",
    style: { "border-color": "#eab308", "border-width": 3 },
  },
  {
    selector: "node.search-match",
    style: { "border-color": "#fff", "border-width": 3, "background-opacity": 0.6 },
  },
  {
    selector: "edge",
    style: {
      width: 1.5,
      "line-color": "#444",
      "target-arrow-color": "#444",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      "arrow-scale": 0.8,
    },
  },
  {
    selector: "edge.highlighted",
    style: {
      width: 2.5,
      "line-color": "#aaa",
      "target-arrow-color": "#aaa",
    },
  },
  {
    selector: "edge.faded",
    style: { opacity: 0.1 },
  },
];

const DAGRE_LAYOUT: LayoutOptions = {
  name: "dagre",
  rankDir: "LR",
  nodeSep: 40,
  rankSep: 80,
  animate: false,
} as LayoutOptions;

const COSE_LAYOUT: LayoutOptions = {
  name: "cose",
  animate: false,
  nodeRepulsion: () => 8000,
  idealEdgeLength: () => 80,
} as LayoutOptions;

export function createGraph(container: HTMLElement, data: GraphExport): Core {
  const elements = [
    ...data.nodes.map((n) => ({
      data: {
        id: n.id,
        name: n.name,
        nodeType: n.type,
        color: NODE_COLORS[n.type] ?? "#888",
        metadata: n.metadata,
      },
    })),
    ...data.edges.map((e, i) => ({
      data: {
        id: `edge-${i}`,
        source: e.from,
        target: e.to,
        edgeType: e.type,
        metadata: e.metadata,
      },
    })),
  ];

  const cy = cytoscape({
    container,
    elements,
    style: STYLE,
    layout: DAGRE_LAYOUT,
    minZoom: 0.1,
    maxZoom: 5,
    wheelSensitivity: 0.3,
  });

  return cy;
}

export function runLayout(cy: Core, layout: "dagre" | "cose"): void {
  const opts = layout === "dagre" ? DAGRE_LAYOUT : COSE_LAYOUT;
  cy.layout(opts).run();
}

export function filterByType(cy: Core, visibleTypes: Set<string>): void {
  cy.nodes().forEach((node) => {
    const type = node.data("nodeType");
    if (visibleTypes.has(type)) {
      node.style("display", "element");
    } else {
      node.style("display", "none");
    }
  });
}

export { NODE_COLORS };
```

- [ ] **Step 2: Commit**

```bash
git add src/client/graph/renderer.ts
git commit -m "feat: add Cytoscape graph renderer with styling and layout"
```

---

## Task 8: Graph interactions — click, hover, select

> **Note:** Use the `frontend-design:frontend-design` skill for this task.

**Files:**
- Create: `../adf-graph-ui/src/client/graph/interactions.ts`

- [ ] **Step 1: Implement interactions**

Create `src/client/graph/interactions.ts`:

```typescript
import { Core, NodeSingular } from "cytoscape";

export interface SelectionHandler {
  onNodeSelect: (nodeId: string, data: Record<string, unknown>) => void;
  onNodeDeselect: () => void;
}

export function bindInteractions(cy: Core, handler: SelectionHandler): void {
  cy.on("tap", "node", (evt) => {
    const node = evt.target as NodeSingular;
    const data = node.data();

    const connectedEdges = node.connectedEdges();
    const incoming = connectedEdges
      .filter((e) => e.target().id() === node.id())
      .map((e) => ({
        from: e.source().data("name"),
        fromId: e.source().id(),
        type: e.data("edgeType"),
      }));
    const outgoing = connectedEdges
      .filter((e) => e.source().id() === node.id())
      .map((e) => ({
        to: e.target().data("name"),
        toId: e.target().id(),
        type: e.data("edgeType"),
      }));

    handler.onNodeSelect(node.id(), {
      ...data,
      incoming,
      outgoing,
    });
  });

  cy.on("tap", (evt) => {
    if (evt.target === cy) {
      cy.elements().unselect();
      handler.onNodeDeselect();
    }
  });
}

export function focusNode(cy: Core, nodeId: string): void {
  const node = cy.getElementById(nodeId);
  if (node.length > 0) {
    cy.animate({
      center: { eles: node },
      zoom: 2,
    } as any);
    node.select();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/graph/interactions.ts
git commit -m "feat: add graph click/select interactions"
```

---

## Task 9: Graph overlays — impact, lineage, validation highlights

> **Note:** Use the `frontend-design:frontend-design` skill for this task.

**Files:**
- Create: `../adf-graph-ui/src/client/graph/overlays.ts`

- [ ] **Step 1: Implement overlay rendering**

Create `src/client/graph/overlays.ts`:

```typescript
import { Core } from "cytoscape";

export function clearOverlays(cy: Core): void {
  cy.elements().removeClass("faded highlighted highlighted-upstream highlighted-downstream error warning search-match");
  cy.edges().removeClass("highlighted faded");
}

export function applyLineage(cy: Core, result: any): void {
  clearOverlays(cy);

  const pathNodeIds = new Set<string>();
  if (result.paths) {
    for (const path of result.paths) {
      if (path.steps) {
        for (const step of path.steps) {
          if (step.nodeId) pathNodeIds.add(step.nodeId);
        }
      }
    }
  }

  if (pathNodeIds.size > 0) {
    cy.nodes().filter((n) => !pathNodeIds.has(n.id())).addClass("faded");
    cy.nodes().filter((n) => pathNodeIds.has(n.id())).addClass("highlighted-downstream");
    cy.edges().filter((e) =>
      !pathNodeIds.has(e.data("source")) || !pathNodeIds.has(e.data("target"))
    ).addClass("faded");
    cy.edges().filter((e) =>
      pathNodeIds.has(e.data("source")) && pathNodeIds.has(e.data("target"))
    ).addClass("highlighted");
  }
}

export function applyImpactAnalysis(cy: Core, result: any): void {
  clearOverlays(cy);

  const affectedIds = new Set<string>();
  const targetId = result.nodeId;
  affectedIds.add(targetId);

  if (result.affected) {
    for (const item of result.affected) {
      affectedIds.add(item.nodeId);
      const node = cy.getElementById(item.nodeId);
      if (node.length > 0) {
        if (item.path && item.path.length > 0) {
          const firstEdge = item.path[0];
          const isUpstream = firstEdge.to === targetId || affectedIds.has(firstEdge.to);
          node.addClass(isUpstream ? "highlighted-upstream" : "highlighted-downstream");
        }
      }

      if (item.path) {
        for (const edge of item.path) {
          cy.edges().filter((e) =>
            e.data("source") === edge.from && e.data("target") === edge.to
          ).addClass("highlighted");
        }
      }
    }
  }

  cy.nodes().filter((n) => !affectedIds.has(n.id())).addClass("faded");
  cy.edges().filter((e) => !e.hasClass("highlighted")).addClass("faded");
}

export function applyValidation(cy: Core, result: any): void {
  clearOverlays(cy);

  if (result.issues) {
    for (const issue of result.issues) {
      if (issue.nodeId) {
        const node = cy.getElementById(issue.nodeId);
        if (node.length > 0) {
          node.addClass(issue.severity === "error" ? "error" : "warning");
        }
      }
    }
  }
}

export function applySearch(cy: Core, matchIds: string[]): void {
  clearOverlays(cy);
  const matchSet = new Set(matchIds);
  cy.nodes().filter((n) => !matchSet.has(n.id())).addClass("faded");
  cy.nodes().filter((n) => matchSet.has(n.id())).addClass("search-match");

  if (matchIds.length > 0) {
    const matchNodes = cy.nodes().filter((n) => matchSet.has(n.id()));
    cy.animate({ fit: { eles: matchNodes, padding: 50 } } as any);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/graph/overlays.ts
git commit -m "feat: add graph overlay rendering for impact, validation, search"
```

---

## Task 10: Toolbar panel — search and type filters

> **Note:** Use the `frontend-design:frontend-design` skill for this task.

**Files:**
- Create: `../adf-graph-ui/src/client/panels/toolbar.ts`

- [ ] **Step 1: Implement toolbar**

Create `src/client/panels/toolbar.ts`:

```typescript
import { Core } from "cytoscape";
import { NODE_COLORS, filterByType } from "../graph/renderer.js";
import { applySearch, clearOverlays } from "../graph/overlays.js";
import { callTool, fetchGraph } from "../api.js";

const ALL_TYPES = [
  "pipeline", "activity", "stored_procedure", "table",
  "dataverse_entity", "dataset", "linked_service", "key_vault_secret",
];

const TYPE_LABELS: Record<string, string> = {
  pipeline: "Pipelines",
  activity: "Activities",
  stored_procedure: "SPs",
  table: "Tables",
  dataverse_entity: "Entities",
  dataset: "Datasets",
  linked_service: "Linked Svcs",
  key_vault_secret: "Secrets",
};

export function initToolbar(
  container: HTMLElement,
  cy: Core,
  onRefresh: (data: unknown) => void,
): void {
  const visibleTypes = new Set(ALL_TYPES);

  const searchInput = container.querySelector<HTMLInputElement>("#search-input")!;
  const filtersContainer = container.querySelector<HTMLElement>("#type-filters")!;
  const refreshBtn = container.querySelector<HTMLElement>("#refresh-btn")!;

  for (const type of ALL_TYPES) {
    const btn = document.createElement("button");
    btn.className = "filter-btn active";
    btn.dataset.type = type;
    btn.textContent = TYPE_LABELS[type] ?? type;
    btn.style.setProperty("--filter-color", NODE_COLORS[type] ?? "#888");

    btn.addEventListener("click", () => {
      if (visibleTypes.has(type)) {
        visibleTypes.delete(type);
        btn.classList.remove("active");
      } else {
        visibleTypes.add(type);
        btn.classList.add("active");
      }
      filterByType(cy, visibleTypes);
    });

    filtersContainer.appendChild(btn);
  }

  let searchTimeout: ReturnType<typeof setTimeout>;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    const query = searchInput.value.trim();
    if (!query) {
      clearOverlays(cy);
      return;
    }
    searchTimeout = setTimeout(async () => {
      const result = await callTool("graph_search", { query, detail: "summary" }) as any;
      const matchIds: string[] = [];
      if (result.nodes) {
        for (const n of result.nodes) matchIds.push(n.id ?? n.nodeId);
      }
      if (result.activities) {
        for (const a of result.activities) matchIds.push(a.nodeId);
      }
      applySearch(cy, matchIds);
    }, 300);
  });

  refreshBtn.addEventListener("click", async () => {
    refreshBtn.textContent = "Refreshing...";
    const data = await fetchGraph(true);
    onRefresh(data);
    refreshBtn.textContent = "⟳ Refresh";
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/panels/toolbar.ts
git commit -m "feat: add toolbar with search, type filters, and refresh"
```

---

## Task 11: Inspector panel — node detail and actions

> **Note:** Use the `frontend-design:frontend-design` skill for this task.

**Files:**
- Create: `../adf-graph-ui/src/client/panels/inspector.ts`

- [ ] **Step 1: Implement inspector**

Create `src/client/panels/inspector.ts`:

```typescript
import { Core } from "cytoscape";
import { NODE_COLORS } from "../graph/renderer.js";
import { callTool } from "../api.js";
import { applyImpactAnalysis, applyLineage, applyValidation, clearOverlays } from "../graph/overlays.js";
import { focusNode } from "../graph/interactions.js";

export function initInspector(
  container: HTMLElement,
  cy: Core,
): { onNodeSelect: (id: string, data: Record<string, unknown>) => void; onNodeDeselect: () => void } {
  function onNodeSelect(nodeId: string, data: Record<string, unknown>) {
    const color = NODE_COLORS[data.nodeType as string] ?? "#888";
    const incoming = (data.incoming as any[]) ?? [];
    const outgoing = (data.outgoing as any[]) ?? [];
    const metadata = (data.metadata as Record<string, unknown>) ?? {};

    container.innerHTML = `
      <div class="inspector-header">
        <div class="inspector-name" style="color: ${color}">${data.name}</div>
        <div class="inspector-type">${data.nodeType}</div>
      </div>
      <div class="inspector-section">
        <div class="inspector-label">Connections</div>
        ${incoming.map((e: any) =>
          `<div class="inspector-connection" data-node-id="${e.fromId}">← <span style="color: ${NODE_COLORS[e.fromType] ?? '#ccc'}">${e.from}</span> <span class="edge-type">${e.type}</span></div>`
        ).join("")}
        ${outgoing.map((e: any) =>
          `<div class="inspector-connection" data-node-id="${e.toId}">→ <span style="color: ${NODE_COLORS[e.toType] ?? '#ccc'}">${e.to}</span> <span class="edge-type">${e.type}</span></div>`
        ).join("")}
        ${incoming.length === 0 && outgoing.length === 0 ? '<div class="inspector-empty">No connections</div>' : ""}
      </div>
      ${renderMetadata(metadata)}
      <div class="inspector-section">
        <div class="inspector-label">Actions</div>
        <div class="inspector-actions">
          <button class="action-btn" data-action="impact">Impact Analysis</button>
          <button class="action-btn" data-action="lineage">Data Lineage</button>
          <button class="action-btn" data-action="validate">Validate</button>
          <button class="action-btn action-btn-clear" data-action="clear">Clear Overlays</button>
        </div>
      </div>
    `;

    container.querySelectorAll(".inspector-connection").forEach((el) => {
      el.addEventListener("click", () => {
        const id = (el as HTMLElement).dataset.nodeId;
        if (id) focusNode(cy, id);
      });
    });

    container.querySelectorAll(".action-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = (btn as HTMLElement).dataset.action;
        if (action === "clear") {
          clearOverlays(cy);
          return;
        }
        if (action === "impact") {
          const nodeType = data.nodeType as string;
          const result = await callTool("graph_impact_analysis", {
            target: data.name as string,
            target_type: nodeType,
            direction: "both",
          });
          applyImpactAnalysis(cy, result);
        }
        if (action === "lineage") {
          const result = await callTool("graph_data_lineage", {
            entity: data.name as string,
            direction: "upstream",
            detail: "full",
          });
          applyLineage(cy, result);
        }
        if (action === "validate") {
          const result = await callTool("graph_validate");
          applyValidation(cy, result);
        }
      });
    });
  }

  function onNodeDeselect() {
    container.innerHTML = `
      <div class="inspector-empty-state">
        <p>Click a node to inspect</p>
      </div>
    `;
  }

  onNodeDeselect();
  return { onNodeSelect, onNodeDeselect };
}

function renderMetadata(metadata: Record<string, unknown>): string {
  const entries = Object.entries(metadata).filter(
    ([k]) => !["stub", "filePath"].includes(k)
  );
  if (entries.length === 0) return "";

  return `
    <div class="inspector-section">
      <div class="inspector-label">Metadata</div>
      <div class="inspector-metadata">
        ${entries.map(([k, v]) => {
          const display = typeof v === "object" ? JSON.stringify(v, null, 2) : String(v);
          return `<div class="meta-entry"><span class="meta-key">${k}</span><span class="meta-value">${display}</span></div>`;
        }).join("")}
      </div>
    </div>
  `;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/panels/inspector.ts
git commit -m "feat: add inspector panel with node detail and action buttons"
```

---

## Task 12: HTML shell and CSS theme

> **Note:** Use the `frontend-design:frontend-design` skill for this task. This is where distinctive visual design matters most — the HTML structure and CSS should produce a polished, non-generic dark UI.

**Files:**
- Create: `../adf-graph-ui/src/client/index.html`
- Create: `../adf-graph-ui/src/client/styles.css`

- [ ] **Step 1: Create HTML shell**

Create `src/client/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>adf-graph-ui</title>
  <link rel="stylesheet" href="./styles.css">
</head>
<body>
  <div id="app">
    <header id="toolbar">
      <span class="logo">adf-graph-ui</span>
      <input id="search-input" type="text" placeholder="Search nodes...">
      <div id="type-filters"></div>
      <button id="refresh-btn">⟳ Refresh</button>
    </header>
    <main>
      <div id="graph-container"></div>
      <aside id="inspector"></aside>
    </main>
    <footer id="status-bar">
      <span id="stats"></span>
      <span id="environment"></span>
      <span id="connection-status">● Connected</span>
    </footer>
  </div>
  <script type="module" src="./main.ts"></script>
</body>
</html>
```

- [ ] **Step 2: Create CSS theme**

Create `src/client/styles.css` with a complete dark theme. This file should cover:

- Full-viewport app layout (header / main with canvas + inspector / footer)
- Toolbar styling: search input, filter buttons with `--filter-color` custom property, refresh button
- Graph container: fills remaining space, dark background
- Inspector panel: 280px right sidebar, scrollable, sections for header/connections/metadata/actions
- Status bar: slim footer with stats
- Action buttons, connection links, metadata entries
- `.filter-btn.active` vs inactive states
- Responsive and keyboard-accessible focus styles

The CSS should produce a distinctive, polished dark interface — not a generic dark mode. Use the `frontend-design:frontend-design` skill to ensure high design quality.

- [ ] **Step 3: Commit**

```bash
git add src/client/index.html src/client/styles.css
git commit -m "feat: add HTML shell and dark theme CSS"
```

---

## Task 13: Main app bootstrap — wire everything together

> **Note:** Use the `frontend-design:frontend-design` skill for this task.

**Files:**
- Create: `../adf-graph-ui/src/client/main.ts`

- [ ] **Step 1: Implement main.ts**

Create `src/client/main.ts`:

```typescript
import { fetchGraph } from "./api.js";
import { createGraph, runLayout } from "./graph/renderer.js";
import { bindInteractions } from "./graph/interactions.js";
import { initToolbar } from "./panels/toolbar.js";
import { initInspector } from "./panels/inspector.js";
import "./styles.css";

async function init() {
  const statsEl = document.getElementById("stats")!;
  const envEl = document.getElementById("environment")!;
  const statusEl = document.getElementById("connection-status")!;

  statsEl.textContent = "Loading graph...";

  try {
    const data = await fetchGraph();

    statsEl.textContent = `Nodes: ${data.stats.nodeCount} · Edges: ${data.stats.edgeCount}`;
    envEl.textContent = `Environment: ${data.environment}`;
    statusEl.textContent = "● Connected";
    statusEl.className = "connected";

    const container = document.getElementById("graph-container")!;
    const cy = createGraph(container, data);

    const inspectorEl = document.getElementById("inspector")!;
    const inspector = initInspector(inspectorEl, cy);

    bindInteractions(cy, inspector);

    const toolbarEl = document.getElementById("toolbar")!;
    initToolbar(toolbarEl, cy, (newData: unknown) => {
      const d = newData as typeof data;
      statsEl.textContent = `Nodes: ${d.stats.nodeCount} · Edges: ${d.stats.edgeCount}`;
      envEl.textContent = `Environment: ${d.environment}`;
    });
  } catch (err: any) {
    statsEl.textContent = `Error: ${err.message}`;
    statusEl.textContent = "● Disconnected";
    statusEl.className = "disconnected";
  }
}

init();
```

- [ ] **Step 2: Verify the client builds**

Run: `npx vite build`
Expected: Build completes with output in `dist/client/`

- [ ] **Step 3: Commit**

```bash
git add src/client/main.ts
git commit -m "feat: add main app bootstrap"
```

---

## Task 14: Full build and integration test

**Files:**
- No new files — this validates everything works together

- [ ] **Step 1: Build the full project**

Run: `npm run build`
Expected: Both Vite (client) and tsc (server) complete without errors

- [ ] **Step 2: Verify dist structure**

```bash
ls dist/server/    # should contain index.js, mcp-client.js, api.js
ls dist/client/    # should contain index.html, assets/
```

- [ ] **Step 3: Run the test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 4: Manual smoke test**

Start the server with adf-graph available (requires ADF_CONFIG or ADF_ROOT to be set):

```bash
ADF_CONFIG=/path/to/adf-graph.json npm start
```

Open `http://localhost:3000` in a browser and verify:
- Graph loads and renders with node/edge visualization
- Nodes are color-coded by type
- Clicking a node opens the inspector with connections and metadata
- Search filters nodes
- Type filter toggles hide/show node types
- Impact Analysis highlights upstream/downstream nodes
- Refresh re-fetches the graph

- [ ] **Step 5: Commit any fixes discovered during smoke test**

```bash
git add -A
git commit -m "fix: address issues found during integration testing"
```

---

## Task 15: Create GitHub repo and push

- [ ] **Step 1: Create the GitHub repo**

```bash
gh repo create HurleySk/adf-graph-ui --public --description "Interactive visualization for adf-graph dependency graphs" --source .
```

- [ ] **Step 2: Push all commits**

```bash
git push -u origin master
```

- [ ] **Step 3: Add CLAUDE.md to the new repo**

Create `CLAUDE.md`:

```markdown
# adf-graph-ui

Interactive web visualization for adf-graph dependency graphs.

## Build & Test

- Build: `npm run build`
- Test: `npm test`
- Dev: `npm run dev` (Vite + tsc watch)
- Start: `npm start` (production server)

## Architecture

- `src/server/index.ts` — Express entry point, spawns adf-graph MCP child process
- `src/server/mcp-client.ts` — MCP stdio client, tool call wrapper
- `src/server/api.ts` — REST API routes proxying MCP tools
- `src/client/main.ts` — App bootstrap, fetches graph, initializes Cytoscape
- `src/client/graph/renderer.ts` — Cytoscape setup, styling, layout algorithms
- `src/client/graph/interactions.ts` — Node click/select/focus handlers
- `src/client/graph/overlays.ts` — Impact/validation/search visual overlays
- `src/client/panels/toolbar.ts` — Search bar, type filter toggles, refresh
- `src/client/panels/inspector.ts` — Right panel: node detail, connections, action buttons
- `src/client/api.ts` — Fetch wrapper for backend API

## Configuration

Requires adf-graph to be installed. Start with:

\`\`\`bash
adf-graph-ui --adf-graph-path /path/to/adf-graph
# or
adf-graph-ui --npx
\`\`\`

The adf-graph child process inherits environment variables (`ADF_CONFIG`, `ADF_ROOT`).
```

- [ ] **Step 4: Commit and push CLAUDE.md**

```bash
git add CLAUDE.md
git commit -m "docs: add CLAUDE.md"
git push
```
