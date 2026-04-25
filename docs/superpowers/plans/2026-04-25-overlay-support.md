# Overlay Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users overlay local/in-progress ADF files onto existing environments, producing a merged graph view alongside the clean base, with runtime MCP tools for agent-driven management.

**Architecture:** The `GraphManager` gains overlay and runtime-environment tracking. A new `src/graph/overlay.ts` module handles content-based artifact type detection, loose-file scanning, and graph merge logic. `Graph` gets a `clone()` method. `StalenessChecker` supports multiple watched paths. Five new MCP tools provide runtime overlay/environment management.

**Tech Stack:** TypeScript, vitest, MCP SDK, zod

---

### Task 1: Graph.clone() method

**Files:**
- Modify: `src/graph/model.ts`
- Test: `tests/graph/model.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/graph/model.test.ts`:

```typescript
it("clones a graph with independent node/edge copies", () => {
  const g = new Graph();
  g.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A", metadata: { x: 1 } });
  g.addNode({ id: "pipeline:B", type: NodeType.Pipeline, name: "B", metadata: {} });
  g.addEdge({ from: "pipeline:A", to: "pipeline:B", type: EdgeType.Executes, metadata: {} });

  const cloned = g.clone();

  // Same content
  expect(cloned.getNode("pipeline:A")).toEqual(g.getNode("pipeline:A"));
  expect(cloned.getNode("pipeline:B")).toEqual(g.getNode("pipeline:B"));
  expect(cloned.getOutgoing("pipeline:A")).toEqual(g.getOutgoing("pipeline:A"));
  expect(cloned.getIncoming("pipeline:B")).toEqual(g.getIncoming("pipeline:B"));
  expect(cloned.stats()).toEqual(g.stats());

  // Independent copies — mutating clone doesn't affect original
  cloned.addNode({ id: "pipeline:C", type: NodeType.Pipeline, name: "C", metadata: {} });
  expect(cloned.stats().nodeCount).toBe(3);
  expect(g.stats().nodeCount).toBe(2);
});

it("clones an empty graph", () => {
  const g = new Graph();
  const cloned = g.clone();
  expect(cloned.stats().nodeCount).toBe(0);
  expect(cloned.stats().edgeCount).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/graph/model.test.ts`
Expected: FAIL — `g.clone is not a function`

- [ ] **Step 3: Implement clone()**

Add to `src/graph/model.ts` inside the `Graph` class, after the `findPaths` method:

```typescript
clone(): Graph {
  const copy = new Graph();
  for (const node of this.nodes.values()) {
    copy.addNode({ ...node, metadata: { ...node.metadata } });
  }
  for (const edges of this.outgoing.values()) {
    for (const edge of edges) {
      copy.addEdge({ ...edge, metadata: { ...edge.metadata } });
    }
  }
  return copy;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/graph/model.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/graph/model.ts tests/graph/model.test.ts
git commit -m "feat: add Graph.clone() for deep-copying graphs"
```

---

### Task 2: Graph.replaceNode() and Graph.removeEdgesForNode()

The overlay merge needs to replace a node and its edges wholesale. `Graph` currently has no remove/replace methods.

**Files:**
- Modify: `src/graph/model.ts`
- Test: `tests/graph/model.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/graph/model.test.ts`:

```typescript
it("replaceNode replaces an existing node's data", () => {
  const g = new Graph();
  g.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A", metadata: { v: 1 } });
  g.replaceNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A-updated", metadata: { v: 2 } });
  expect(g.getNode("pipeline:A")!.name).toBe("A-updated");
  expect(g.getNode("pipeline:A")!.metadata).toEqual({ v: 2 });
});

it("replaceNode adds the node if it didn't exist", () => {
  const g = new Graph();
  g.replaceNode({ id: "pipeline:X", type: NodeType.Pipeline, name: "X", metadata: {} });
  expect(g.getNode("pipeline:X")).toBeDefined();
});

it("removeEdgesForNode removes all outgoing and incoming edges for a node", () => {
  const g = new Graph();
  g.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A", metadata: {} });
  g.addNode({ id: "pipeline:B", type: NodeType.Pipeline, name: "B", metadata: {} });
  g.addNode({ id: "pipeline:C", type: NodeType.Pipeline, name: "C", metadata: {} });
  g.addEdge({ from: "pipeline:A", to: "pipeline:B", type: EdgeType.Executes, metadata: {} });
  g.addEdge({ from: "pipeline:C", to: "pipeline:A", type: EdgeType.DependsOn, metadata: {} });
  g.addEdge({ from: "pipeline:B", to: "pipeline:C", type: EdgeType.Executes, metadata: {} });

  g.removeEdgesForNode("pipeline:A");

  expect(g.getOutgoing("pipeline:A")).toHaveLength(0);
  expect(g.getIncoming("pipeline:A")).toHaveLength(0);
  // Edge B→C should survive
  expect(g.getOutgoing("pipeline:B")).toHaveLength(1);
  expect(g.getIncoming("pipeline:C")).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/graph/model.test.ts`
Expected: FAIL — `g.replaceNode is not a function`

- [ ] **Step 3: Implement replaceNode() and removeEdgesForNode()**

Add to `src/graph/model.ts` inside the `Graph` class:

```typescript
replaceNode(node: GraphNode): void {
  this.nodes.set(node.id, node);
  if (!this.outgoing.has(node.id)) {
    this.outgoing.set(node.id, []);
  }
  if (!this.incoming.has(node.id)) {
    this.incoming.set(node.id, []);
  }
}

removeEdgesForNode(id: string): void {
  // Remove outgoing edges and clean up the targets' incoming lists
  const outgoing = this.outgoing.get(id) ?? [];
  for (const edge of outgoing) {
    const targetIncoming = this.incoming.get(edge.to);
    if (targetIncoming) {
      const filtered = targetIncoming.filter((e) => e.from !== id);
      this.incoming.set(edge.to, filtered);
    }
  }
  this.outgoing.set(id, []);

  // Remove incoming edges and clean up the sources' outgoing lists
  const incoming = this.incoming.get(id) ?? [];
  for (const edge of incoming) {
    const sourceOutgoing = this.outgoing.get(edge.from);
    if (sourceOutgoing) {
      const filtered = sourceOutgoing.filter((e) => e.to !== id);
      this.outgoing.set(edge.from, filtered);
    }
  }
  this.incoming.set(id, []);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/graph/model.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/graph/model.ts tests/graph/model.test.ts
git commit -m "feat: add Graph.replaceNode() and removeEdgesForNode()"
```

---

### Task 3: StalenessChecker multi-path support

**Files:**
- Modify: `src/graph/staleness.ts`
- Test: `tests/graph/staleness.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/graph/staleness.test.ts`:

```typescript
describe("multi-path support", () => {
  it("accepts an array of root paths", () => {
    const dir1 = join(tmpDir, "root1");
    const dir2 = join(tmpDir, "root2");
    mkdirSync(join(dir1, "pipeline"), { recursive: true });
    mkdirSync(join(dir2, "pipeline"), { recursive: true });

    const checker = new StalenessChecker([dir1, dir2]);
    checker.markBuilt();
    expect(checker.isStale()).toBe(false);
  });

  it("detects staleness from any watched path", async () => {
    const dir1 = join(tmpDir, "root1");
    const dir2 = join(tmpDir, "root2");
    mkdirSync(join(dir1, "pipeline"), { recursive: true });
    mkdirSync(join(dir2, "pipeline"), { recursive: true });
    writeFileSync(join(dir1, "pipeline", "a.json"), "{}");

    const checker = new StalenessChecker([dir1, dir2]);
    checker.markBuilt();
    expect(checker.isStale()).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Write to dir2 — should make the checker stale
    writeFileSync(join(dir2, "pipeline", "b.json"), "{}");
    expect(checker.isStale()).toBe(true);
  });

  it("single string constructor still works (backward compat)", () => {
    const checker = new StalenessChecker(tmpDir);
    checker.markBuilt();
    expect(checker.isStale()).toBe(false);
  });

  it("addPath registers a new path and forces staleness", () => {
    const dir1 = join(tmpDir, "root1");
    mkdirSync(join(dir1, "pipeline"), { recursive: true });

    const checker = new StalenessChecker(dir1);
    checker.markBuilt();
    expect(checker.isStale()).toBe(false);

    const dir2 = join(tmpDir, "root2");
    mkdirSync(join(dir2, "pipeline"), { recursive: true });
    checker.addPath(dir2);
    expect(checker.isStale()).toBe(true);
  });

  it("removePath unregisters a path and forces staleness", () => {
    const dir1 = join(tmpDir, "root1");
    const dir2 = join(tmpDir, "root2");
    mkdirSync(join(dir1, "pipeline"), { recursive: true });
    mkdirSync(join(dir2, "pipeline"), { recursive: true });

    const checker = new StalenessChecker([dir1, dir2]);
    checker.markBuilt();
    expect(checker.isStale()).toBe(false);

    checker.removePath(dir2);
    expect(checker.isStale()).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/graph/staleness.test.ts`
Expected: FAIL — constructor doesn't accept arrays

- [ ] **Step 3: Update StalenessChecker**

Replace `src/graph/staleness.ts` with:

```typescript
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

const WATCHED_DIRS = ["pipeline", "dataset", "linkedService", "SQL DB"];

function maxMtimeMs(dir: string): number {
  if (!existsSync(dir)) return 0;

  let max = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      const sub = maxMtimeMs(fullPath);
      if (sub > max) max = sub;
    } else {
      if (stat.mtimeMs > max) max = stat.mtimeMs;
    }
  }
  return max;
}

export class StalenessChecker {
  private rootPaths: string[];
  private builtAt: number | null = null;
  private builtMaxMtime: number | null = null;

  constructor(rootPath: string | string[]) {
    this.rootPaths = Array.isArray(rootPath) ? [...rootPath] : [rootPath];
  }

  isStale(): boolean {
    if (this.builtAt === null || this.builtMaxMtime === null) return true;
    if (this.rootPaths.length === 0) return true;
    if (!this.rootPaths.some((p) => existsSync(p))) return true;

    const currentMax = this.currentMaxMtime();
    return currentMax > this.builtMaxMtime;
  }

  markBuilt(): void {
    this.builtMaxMtime = this.currentMaxMtime();
    this.builtAt = Date.now();
  }

  lastBuildTime(): Date | null {
    if (this.builtAt === null) return null;
    return new Date(this.builtAt);
  }

  addPath(path: string): void {
    if (!this.rootPaths.includes(path)) {
      this.rootPaths.push(path);
      this.invalidate();
    }
  }

  removePath(path: string): void {
    const idx = this.rootPaths.indexOf(path);
    if (idx !== -1) {
      this.rootPaths.splice(idx, 1);
      this.invalidate();
    }
  }

  private invalidate(): void {
    this.builtAt = null;
    this.builtMaxMtime = null;
  }

  private currentMaxMtime(): number {
    let max = 0;
    for (const rootPath of this.rootPaths) {
      for (const dir of WATCHED_DIRS) {
        const fullDir = join(rootPath, dir);
        const m = maxMtimeMs(fullDir);
        if (m > max) max = m;
      }
    }
    return max;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/graph/staleness.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: ALL PASS (the `GraphManager` constructs `StalenessChecker` with a single string — still works)

- [ ] **Step 6: Commit**

```bash
git add src/graph/staleness.ts tests/graph/staleness.test.ts
git commit -m "feat: StalenessChecker supports multiple root paths"
```

---

### Task 4: Config schema — overlays and + validation

**Files:**
- Modify: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/config.test.ts`:

```typescript
describe("overlays in config", () => {
  it("parses overlays array for an environment", () => {
    const cfgPath = writeConfig("overlays.json", {
      environments: {
        main: {
          path: "/some/path",
          default: true,
          overlays: ["/overlay/dir", "/overlay/file.json"],
        },
      },
    });
    setEnv({ ADF_CONFIG: cfgPath });

    const config = loadConfig();
    expect(config.environments["main"].overlays).toEqual([
      "/overlay/dir",
      "/overlay/file.json",
    ]);
  });

  it("defaults overlays to undefined when not provided", () => {
    const cfgPath = writeConfig("no-overlays.json", {
      environments: {
        main: { path: "/some/path", default: true },
      },
    });
    setEnv({ ADF_CONFIG: cfgPath });

    const config = loadConfig();
    expect(config.environments["main"].overlays).toBeUndefined();
  });

  it("rejects non-array overlays value", () => {
    const cfgPath = writeConfig("bad-overlays.json", {
      environments: {
        main: { path: "/some/path", overlays: "not-an-array" },
      },
    });
    setEnv({ ADF_CONFIG: cfgPath });
    expect(() => loadConfig()).toThrow(/overlays.*must be an array/);
  });

  it("rejects non-string entries in overlays array", () => {
    const cfgPath = writeConfig("bad-overlay-entry.json", {
      environments: {
        main: { path: "/some/path", overlays: [123] },
      },
    });
    setEnv({ ADF_CONFIG: cfgPath });
    expect(() => loadConfig()).toThrow(/overlays.*must be non-empty strings/);
  });
});

describe("+ in environment name", () => {
  it("rejects environment names containing +", () => {
    const cfgPath = writeConfig("plus-name.json", {
      environments: {
        "my+env": { path: "/some/path" },
      },
    });
    setEnv({ ADF_CONFIG: cfgPath });
    expect(() => loadConfig()).toThrow(/cannot contain '\+'/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — overlays not parsed, `+` not validated

- [ ] **Step 3: Update config.ts**

In `src/config.ts`, update the `EnvironmentConfig` interface:

```typescript
export interface EnvironmentConfig {
  path: string;
  default?: boolean;
  overlays?: string[];
}
```

In the `validateConfig` function, inside the `for` loop (after the `path` check), add:

```typescript
if (name.includes("+")) {
  throw new Error(
    `adf-graph: environment name '${name}' in '${source}' cannot contain '+' (reserved for merged views)`,
  );
}
```

After the existing `path` validation inside the loop, add:

```typescript
let overlays: string[] | undefined;
if (envObj.overlays !== undefined) {
  if (!Array.isArray(envObj.overlays)) {
    throw new Error(
      `adf-graph: environment '${name}' in '${source}': overlays must be an array of strings`,
    );
  }
  for (const entry of envObj.overlays) {
    if (typeof entry !== "string" || !entry) {
      throw new Error(
        `adf-graph: environment '${name}' in '${source}': overlays entries must be non-empty strings`,
      );
    }
  }
  overlays = envObj.overlays as string[];
}
```

Update the environment assignment:

```typescript
environments[name] = {
  path: envObj.path,
  ...(envObj.default === true ? { default: true } : {}),
  ...(overlays ? { overlays } : {}),
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: config supports overlays array and rejects + in env names"
```

---

### Task 5: Artifact type detection

**Files:**
- Create: `src/graph/overlay.ts`
- Create: `tests/graph/overlay.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/graph/overlay.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { detectArtifactType } from "../../src/graph/overlay.js";

describe("detectArtifactType", () => {
  it("detects pipeline from properties.activities", () => {
    const json = {
      name: "MyPipeline",
      properties: {
        activities: [{ name: "Act1", type: "Copy" }],
      },
    };
    expect(detectArtifactType(json)).toBe("pipeline");
  });

  it("detects dataset from properties.typeProperties + AzureSqlTable type", () => {
    const json = {
      name: "MyDataset",
      properties: {
        type: "AzureSqlTable",
        typeProperties: { schema: "dbo", table: "Foo" },
      },
    };
    expect(detectArtifactType(json)).toBe("dataset");
  });

  it("detects dataset from DelimitedText type", () => {
    const json = {
      name: "CsvDs",
      properties: {
        type: "DelimitedText",
        typeProperties: { location: {} },
      },
    };
    expect(detectArtifactType(json)).toBe("dataset");
  });

  it("returns null for unrecognized JSON", () => {
    const json = { name: "Unknown", properties: { foo: "bar" } };
    expect(detectArtifactType(json)).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(detectArtifactType("not an object")).toBeNull();
    expect(detectArtifactType(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/graph/overlay.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement detectArtifactType**

Create `src/graph/overlay.ts`:

```typescript
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, extname } from "path";
import { Graph, GraphNode, GraphEdge } from "./model.js";
import { ParseResult, parsePipelineFile } from "../parsers/pipeline.js";
import { parseDatasetFile } from "../parsers/dataset.js";
import { buildGraph, BuildResult } from "./builder.js";

const DATASET_TYPES = new Set([
  "AzureSqlTable",
  "SqlServerTable",
  "AzureBlobStorage",
  "AzureBlobFSLocation",
  "DelimitedText",
  "Json",
  "Parquet",
  "Avro",
  "Orc",
  "Binary",
  "Excel",
  "CommonDataServiceForAppsEntity",
  "DynamicsEntity",
]);

export type ArtifactType = "pipeline" | "dataset" | "sql";

export function detectArtifactType(json: unknown): ArtifactType | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const root = json as Record<string, unknown>;
  const properties = root.properties as Record<string, unknown> | undefined;
  if (!properties) return null;

  // Pipeline: has properties.activities array
  if (Array.isArray(properties.activities)) {
    return "pipeline";
  }

  // Dataset: has properties.typeProperties and a known dataset type
  const typeName = properties.type as string | undefined;
  if (properties.typeProperties && typeName && DATASET_TYPES.has(typeName)) {
    return "dataset";
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/graph/overlay.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/graph/overlay.ts tests/graph/overlay.test.ts
git commit -m "feat: artifact type detection for loose overlay files"
```

---

### Task 6: Overlay scanning and graph merge logic

**Files:**
- Modify: `src/graph/overlay.ts`
- Modify: `tests/graph/overlay.test.ts`
- Create: `tests/fixtures/overlay-structured/pipeline/OverlayPipeline.json`
- Create: `tests/fixtures/overlay-loose/LoosePipeline.json`
- Create: `tests/fixtures/overlay-loose/LooseDataset.json`
- Create: `tests/fixtures/overlay-loose/notes.txt`

- [ ] **Step 1: Create test fixture files**

Create `tests/fixtures/overlay-structured/pipeline/OverlayPipeline.json`:

```json
{
  "name": "OverlayPipeline",
  "properties": {
    "activities": [
      {
        "name": "Overlay Activity",
        "type": "Copy",
        "dependsOn": [],
        "typeProperties": {},
        "inputs": [],
        "outputs": []
      }
    ]
  }
}
```

Create `tests/fixtures/overlay-loose/LoosePipeline.json`:

```json
{
  "name": "LoosePipeline",
  "properties": {
    "activities": [
      {
        "name": "Loose Activity",
        "type": "Copy",
        "dependsOn": [],
        "typeProperties": {},
        "inputs": [],
        "outputs": []
      }
    ]
  }
}
```

Create `tests/fixtures/overlay-loose/LooseDataset.json`:

```json
{
  "name": "LooseDataset",
  "properties": {
    "type": "AzureSqlTable",
    "linkedServiceName": {
      "referenceName": "ls_test",
      "type": "LinkedServiceReference"
    },
    "typeProperties": {
      "schema": "dbo",
      "table": "TestTable"
    }
  }
}
```

Create `tests/fixtures/overlay-loose/notes.txt`:

```
This file should be silently skipped.
```

- [ ] **Step 2: Write the failing tests**

Add to `tests/graph/overlay.test.ts`:

```typescript
import { join } from "path";
import { Graph, NodeType, EdgeType } from "../../src/graph/model.js";
import { scanOverlayPath, mergeOverlayInto } from "../../src/graph/overlay.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

describe("scanOverlayPath", () => {
  it("scans a structured overlay directory (has pipeline/ subdir)", () => {
    const overlayDir = join(fixtureRoot, "overlay-structured");
    const result = scanOverlayPath(overlayDir);
    expect(result.nodes.length).toBeGreaterThan(0);
    const pipelineNode = result.nodes.find((n) => n.name === "OverlayPipeline");
    expect(pipelineNode).toBeDefined();
  });

  it("scans loose files and detects types", () => {
    const overlayDir = join(fixtureRoot, "overlay-loose");
    const result = scanOverlayPath(overlayDir);
    const names = result.nodes.map((n) => n.name);
    expect(names).toContain("LoosePipeline");
    expect(names).toContain("LooseDataset");
    // notes.txt should be skipped — no warning for non-json/non-sql
    expect(result.warnings.every((w) => !w.includes("notes.txt"))).toBe(true);
  });

  it("scans a single file path", () => {
    const filePath = join(fixtureRoot, "overlay-loose", "LoosePipeline.json");
    const result = scanOverlayPath(filePath);
    expect(result.nodes.find((n) => n.name === "LoosePipeline")).toBeDefined();
  });

  it("warns for ambiguous JSON files", () => {
    const filePath = join(fixtureRoot, "overlay-loose", "notes.txt");
    const result = scanOverlayPath(filePath);
    expect(result.nodes).toHaveLength(0);
  });
});

describe("mergeOverlayInto", () => {
  it("adds new nodes from overlay", () => {
    const base = new Graph();
    base.addNode({ id: "pipeline:Base", type: NodeType.Pipeline, name: "Base", metadata: {} });

    const overlay = new Graph();
    overlay.addNode({ id: "pipeline:New", type: NodeType.Pipeline, name: "New", metadata: {} });

    mergeOverlayInto(base, overlay);

    expect(base.getNode("pipeline:Base")).toBeDefined();
    expect(base.getNode("pipeline:New")).toBeDefined();
    expect(base.stats().nodeCount).toBe(2);
  });

  it("replaces existing nodes and their edges", () => {
    const base = new Graph();
    base.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A-original", metadata: {} });
    base.addNode({ id: "pipeline:B", type: NodeType.Pipeline, name: "B", metadata: {} });
    base.addEdge({ from: "pipeline:A", to: "pipeline:B", type: EdgeType.Executes, metadata: {} });

    const overlay = new Graph();
    overlay.addNode({ id: "pipeline:A", type: NodeType.Pipeline, name: "A-replaced", metadata: {} });
    overlay.addNode({ id: "pipeline:C", type: NodeType.Pipeline, name: "C", metadata: {} });
    overlay.addEdge({ from: "pipeline:A", to: "pipeline:C", type: EdgeType.Executes, metadata: {} });

    mergeOverlayInto(base, overlay);

    expect(base.getNode("pipeline:A")!.name).toBe("A-replaced");
    // Old edge A→B removed
    const outgoing = base.getOutgoing("pipeline:A");
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0].to).toBe("pipeline:C");
    // New node C added
    expect(base.getNode("pipeline:C")).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/graph/overlay.test.ts`
Expected: FAIL — `scanOverlayPath` and `mergeOverlayInto` not exported

- [ ] **Step 4: Implement scanOverlayPath and mergeOverlayInto**

Add to `src/graph/overlay.ts`:

```typescript
export interface OverlayScanResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
}

function hasAdfStructure(dirPath: string): boolean {
  const adfDirs = ["pipeline", "dataset", "linkedService", "SQL DB"];
  return adfDirs.some((d) => existsSync(join(dirPath, d)));
}

function scanLooseFiles(dirPath: string): OverlayScanResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dirPath);
  } catch (err) {
    warnings.push(`Failed to read overlay dir '${dirPath}': ${String(err)}`);
    return { nodes, edges, warnings };
  }

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      const sub = scanLooseFiles(fullPath);
      nodes.push(...sub.nodes);
      edges.push(...sub.edges);
      warnings.push(...sub.warnings);
      continue;
    }

    const ext = extname(entry).toLowerCase();
    if (ext === ".sql") {
      // SQL files in loose overlays are skipped for now (need directory context)
      continue;
    }
    if (ext !== ".json") continue;

    try {
      const json = JSON.parse(readFileSync(fullPath, "utf-8")) as unknown;
      const artifactType = detectArtifactType(json);
      if (artifactType === "pipeline") {
        const result = parsePipelineFile(json);
        nodes.push(...result.nodes);
        edges.push(...result.edges);
        warnings.push(...result.warnings);
      } else if (artifactType === "dataset") {
        const result = parseDatasetFile(json);
        nodes.push(...result.nodes);
        edges.push(...result.edges);
        warnings.push(...result.warnings);
      } else {
        warnings.push(`Could not determine artifact type for '${entry}' — skipping`);
      }
    } catch (err) {
      warnings.push(`Failed to parse overlay file '${entry}': ${String(err)}`);
    }
  }

  return { nodes, edges, warnings };
}

function scanSingleFile(filePath: string): OverlayScanResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];
  const entry = filePath.split(/[\\/]/).pop() ?? filePath;

  const ext = extname(filePath).toLowerCase();
  if (ext !== ".json") {
    return { nodes, edges, warnings };
  }

  try {
    const json = JSON.parse(readFileSync(filePath, "utf-8")) as unknown;
    const artifactType = detectArtifactType(json);
    if (artifactType === "pipeline") {
      const result = parsePipelineFile(json);
      nodes.push(...result.nodes);
      edges.push(...result.edges);
      warnings.push(...result.warnings);
    } else if (artifactType === "dataset") {
      const result = parseDatasetFile(json);
      nodes.push(...result.nodes);
      edges.push(...result.edges);
      warnings.push(...result.warnings);
    } else {
      warnings.push(`Could not determine artifact type for '${entry}' — skipping`);
    }
  } catch (err) {
    warnings.push(`Failed to parse overlay file '${entry}': ${String(err)}`);
  }

  return { nodes, edges, warnings };
}

export function scanOverlayPath(overlayPath: string): OverlayScanResult {
  if (!existsSync(overlayPath)) {
    return { nodes: [], edges: [], warnings: [`Overlay path not found: '${overlayPath}'`] };
  }

  let stat;
  try {
    stat = statSync(overlayPath);
  } catch (err) {
    return { nodes: [], edges: [], warnings: [`Cannot stat overlay path '${overlayPath}': ${String(err)}`] };
  }

  if (!stat.isDirectory()) {
    return scanSingleFile(overlayPath);
  }

  // Directory: check for ADF structure
  if (hasAdfStructure(overlayPath)) {
    const buildResult = buildGraph(overlayPath);
    return {
      nodes: Array.from(getAllNodes(buildResult.graph)),
      edges: Array.from(getAllEdges(buildResult.graph)),
      warnings: buildResult.warnings,
    };
  }

  // Loose files
  return scanLooseFiles(overlayPath);
}

function getAllNodes(graph: Graph): GraphNode[] {
  const nodes: GraphNode[] = [];
  // Use getNodesByType for each type to extract all nodes
  for (const type of Object.values(NodeType)) {
    nodes.push(...graph.getNodesByType(type));
  }
  return nodes;
}

function getAllEdges(graph: Graph): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const node of getAllNodes(graph)) {
    for (const edge of graph.getOutgoing(node.id)) {
      const key = `${edge.from}|${edge.to}|${edge.type}`;
      if (!seen.has(key)) {
        seen.add(key);
        edges.push(edge);
      }
    }
  }
  return edges;
}

export function mergeOverlayInto(target: Graph, overlay: Graph): void {
  const overlayNodes = getAllNodes(overlay);
  const overlayEdges = getAllEdges(overlay);

  // Replace or add nodes
  for (const node of overlayNodes) {
    if (target.getNode(node.id)) {
      target.removeEdgesForNode(node.id);
    }
    target.replaceNode(node);
  }

  // Add all edges from overlay
  for (const edge of overlayEdges) {
    target.addEdge(edge);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/graph/overlay.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/graph/overlay.ts tests/graph/overlay.test.ts tests/fixtures/overlay-structured/ tests/fixtures/overlay-loose/
git commit -m "feat: overlay scanning (structured + loose) and graph merge logic"
```

---

### Task 7: GraphManager — overlay-aware build + merged views

**Files:**
- Modify: `src/graph/manager.ts`
- Modify: `tests/graph/manager.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/graph/manager.test.ts`:

```typescript
import { scanOverlayPath, mergeOverlayInto } from "../../src/graph/overlay.js";

const overlayStructuredDir = join(fixtureRoot, "overlay-structured");
const overlayLooseDir = join(fixtureRoot, "overlay-loose");

describe("overlay support", () => {
  it("creates a merged view when config has overlays", () => {
    const mgr = new GraphManager(
      makeConfig({
        main: {
          path: fixtureRoot,
          default: true,
          overlays: [overlayStructuredDir],
        },
      }),
    );

    const envs = mgr.listEnvironments();
    const names = envs.map((e) => e.name);
    expect(names).toContain("main");
    expect(names).toContain("main+overlays");
  });

  it("merged view contains overlay nodes", () => {
    const mgr = new GraphManager(
      makeConfig({
        main: {
          path: fixtureRoot,
          default: true,
          overlays: [overlayStructuredDir],
        },
      }),
    );

    const merged = mgr.ensureGraph("main+overlays");
    const overlayNode = merged.graph.getNode("pipeline:OverlayPipeline");
    expect(overlayNode).toBeDefined();
  });

  it("base graph does NOT contain overlay nodes", () => {
    const mgr = new GraphManager(
      makeConfig({
        main: {
          path: fixtureRoot,
          default: true,
          overlays: [overlayStructuredDir],
        },
      }),
    );

    const base = mgr.ensureGraph("main");
    expect(base.graph.getNode("pipeline:OverlayPipeline")).toBeUndefined();
  });

  it("default env resolves to merged view when overlays exist", () => {
    const mgr = new GraphManager(
      makeConfig({
        main: {
          path: fixtureRoot,
          default: true,
          overlays: [overlayStructuredDir],
        },
      }),
    );

    expect(mgr.getDefaultEnvironment()).toBe("main+overlays");
  });

  it("default env is base when no overlays", () => {
    const mgr = new GraphManager(
      makeConfig({
        main: { path: fixtureRoot, default: true },
      }),
    );

    expect(mgr.getDefaultEnvironment()).toBe("main");
  });

  it("merged view disappears when overlays are empty array", () => {
    const mgr = new GraphManager(
      makeConfig({
        main: { path: fixtureRoot, default: true, overlays: [] },
      }),
    );

    const envs = mgr.listEnvironments();
    const names = envs.map((e) => e.name);
    expect(names).not.toContain("main+overlays");
  });

  it("listEnvironments shows source and hasOverlays fields", () => {
    const mgr = new GraphManager(
      makeConfig({
        main: {
          path: fixtureRoot,
          default: true,
          overlays: [overlayStructuredDir],
        },
      }),
    );

    const envs = mgr.listEnvironments();
    const main = envs.find((e) => e.name === "main")!;
    expect(main.source).toBe("config");
    expect(main.hasOverlays).toBe(true);

    const merged = envs.find((e) => e.name === "main+overlays")!;
    expect(merged.source).toBe("derived");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/graph/manager.test.ts`
Expected: FAIL — `source` and `hasOverlays` not on EnvironmentInfo, merged views not created

- [ ] **Step 3: Update GraphManager**

Replace `src/graph/manager.ts`:

```typescript
import { AdfGraphConfig, EnvironmentConfig } from "../config.js";
import { buildGraph } from "./builder.js";
import { Graph } from "./model.js";
import { StalenessChecker } from "./staleness.js";
import { scanOverlayPath, mergeOverlayInto } from "./overlay.js";

export interface EnvironmentInfo {
  name: string;
  path: string;
  isDefault: boolean;
  nodeCount: number | null;
  edgeCount: number | null;
  lastBuild: Date | null;
  isStale: boolean;
  source: "config" | "runtime" | "derived";
  hasOverlays: boolean;
}

interface EnvState {
  graph: Graph;
  warnings: string[];
  buildTimeMs: number;
  staleness: StalenessChecker;
}

interface RuntimeEnv {
  path: string;
  overlays: string[];
}

const OVERLAY_SUFFIX = "+overlays";

export class GraphManager {
  private graphs: Map<string, EnvState> = new Map();
  private config: AdfGraphConfig;
  private runtimeEnvs: Map<string, RuntimeEnv> = new Map();
  private runtimeOverlays: Map<string, string[]> = new Map();

  constructor(config: AdfGraphConfig) {
    this.config = config;
  }

  ensureGraph(environment?: string): { graph: Graph; warnings: string[]; buildTimeMs: number } {
    const envName = environment ?? this.getDefaultEnvironment();

    // Is this a merged-view request?
    if (envName.endsWith(OVERLAY_SUFFIX)) {
      const baseName = envName.slice(0, -OVERLAY_SUFFIX.length);
      return this.ensureMergedGraph(baseName);
    }

    // Base environment
    const envConfig = this.getEnvConfig(envName);
    if (!envConfig) {
      const available = this.allEnvironmentNames().join(", ");
      throw new Error(`adf-graph: unknown environment '${envName}'. Available: ${available}`);
    }

    const existing = this.graphs.get(envName);
    if (existing && !existing.staleness.isStale()) {
      return { graph: existing.graph, warnings: existing.warnings, buildTimeMs: existing.buildTimeMs };
    }

    const result = buildGraph(envConfig.path);
    const staleness = existing?.staleness ?? new StalenessChecker(envConfig.path);
    staleness.markBuilt();

    const state: EnvState = {
      graph: result.graph,
      warnings: result.warnings,
      buildTimeMs: result.buildTimeMs,
      staleness,
    };
    this.graphs.set(envName, state);

    // Invalidate merged view if it exists
    this.graphs.delete(envName + OVERLAY_SUFFIX);

    return { graph: result.graph, warnings: result.warnings, buildTimeMs: result.buildTimeMs };
  }

  getDefaultEnvironment(): string {
    const baseDefault = this.resolveBaseDefault();
    const overlays = this.getEffectiveOverlays(baseDefault);
    if (overlays.length > 0) {
      return baseDefault + OVERLAY_SUFFIX;
    }
    return baseDefault;
  }

  listEnvironments(): EnvironmentInfo[] {
    const result: EnvironmentInfo[] = [];
    const defaultEnv = this.getDefaultEnvironment();

    // Config environments
    for (const [name, cfg] of Object.entries(this.config.environments)) {
      const state = this.graphs.get(name);
      const stats = state ? state.graph.stats() : null;
      const overlays = this.getEffectiveOverlays(name);

      result.push({
        name,
        path: cfg.path,
        isDefault: name === defaultEnv,
        nodeCount: stats?.nodeCount ?? null,
        edgeCount: stats?.edgeCount ?? null,
        lastBuild: state ? state.staleness.lastBuildTime() : null,
        isStale: state ? state.staleness.isStale() : true,
        source: "config",
        hasOverlays: overlays.length > 0,
      });

      // Add merged view if overlays exist
      if (overlays.length > 0) {
        const mergedName = name + OVERLAY_SUFFIX;
        const mergedState = this.graphs.get(mergedName);
        const mergedStats = mergedState ? mergedState.graph.stats() : null;
        result.push({
          name: mergedName,
          path: cfg.path,
          isDefault: mergedName === defaultEnv,
          nodeCount: mergedStats?.nodeCount ?? null,
          edgeCount: mergedStats?.edgeCount ?? null,
          lastBuild: mergedState ? mergedState.staleness.lastBuildTime() : null,
          isStale: mergedState ? mergedState.staleness.isStale() : true,
          source: "derived",
          hasOverlays: false,
        });
      }
    }

    // Runtime environments
    for (const [name, renv] of this.runtimeEnvs) {
      const state = this.graphs.get(name);
      const stats = state ? state.graph.stats() : null;
      const overlays = this.getEffectiveOverlays(name);

      result.push({
        name,
        path: renv.path,
        isDefault: name === defaultEnv,
        nodeCount: stats?.nodeCount ?? null,
        edgeCount: stats?.edgeCount ?? null,
        lastBuild: state ? state.staleness.lastBuildTime() : null,
        isStale: state ? state.staleness.isStale() : true,
        source: "runtime",
        hasOverlays: overlays.length > 0,
      });

      if (overlays.length > 0) {
        const mergedName = name + OVERLAY_SUFFIX;
        const mergedState = this.graphs.get(mergedName);
        const mergedStats = mergedState ? mergedState.graph.stats() : null;
        result.push({
          name: mergedName,
          path: renv.path,
          isDefault: mergedName === defaultEnv,
          nodeCount: mergedStats?.nodeCount ?? null,
          edgeCount: mergedStats?.edgeCount ?? null,
          lastBuild: mergedState ? mergedState.staleness.lastBuildTime() : null,
          isStale: mergedState ? mergedState.staleness.isStale() : true,
          source: "derived",
          hasOverlays: false,
        });
      }
    }

    return result;
  }

  addOverlay(environment: string, path: string): void {
    const existing = this.runtimeOverlays.get(environment) ?? [];
    if (!existing.includes(path)) {
      existing.push(path);
      this.runtimeOverlays.set(environment, existing);
    }
    // Invalidate merged view
    this.graphs.delete(environment + OVERLAY_SUFFIX);
  }

  removeOverlay(environment: string, path: string): { removed: boolean; isConfigOverlay: boolean } {
    const configOverlays = this.config.environments[environment]?.overlays ?? [];
    if (configOverlays.includes(path)) {
      return { removed: false, isConfigOverlay: true };
    }

    const existing = this.runtimeOverlays.get(environment);
    if (!existing) return { removed: false, isConfigOverlay: false };
    const idx = existing.indexOf(path);
    if (idx === -1) return { removed: false, isConfigOverlay: false };

    existing.splice(idx, 1);
    if (existing.length === 0) {
      this.runtimeOverlays.delete(environment);
    }
    this.graphs.delete(environment + OVERLAY_SUFFIX);
    return { removed: true, isConfigOverlay: false };
  }

  listOverlays(environment?: string): Array<{ path: string; source: "config" | "runtime" }> {
    const envName = environment ?? this.resolveBaseDefault();
    const configOverlays = this.config.environments[envName]?.overlays ?? [];
    const runtimeOvls = this.runtimeOverlays.get(envName) ?? [];

    return [
      ...configOverlays.map((p) => ({ path: p, source: "config" as const })),
      ...runtimeOvls.map((p) => ({ path: p, source: "runtime" as const })),
    ];
  }

  addEnvironment(name: string, path: string, overlays?: string[]): void {
    if (this.config.environments[name]) {
      throw new Error(`adf-graph: cannot add runtime environment '${name}' — conflicts with a config-based environment`);
    }
    if (name.includes("+")) {
      throw new Error(`adf-graph: environment name '${name}' cannot contain '+'`);
    }
    this.runtimeEnvs.set(name, { path, overlays: overlays ?? [] });
    if (overlays && overlays.length > 0) {
      this.runtimeOverlays.set(name, [...overlays]);
    }
  }

  removeEnvironment(name: string): { removed: boolean; isConfigEnv: boolean } {
    if (this.config.environments[name]) {
      return { removed: false, isConfigEnv: true };
    }
    const existed = this.runtimeEnvs.delete(name);
    this.runtimeOverlays.delete(name);
    this.graphs.delete(name);
    this.graphs.delete(name + OVERLAY_SUFFIX);
    return { removed: existed, isConfigEnv: false };
  }

  private ensureMergedGraph(baseName: string): { graph: Graph; warnings: string[]; buildTimeMs: number } {
    const mergedName = baseName + OVERLAY_SUFFIX;
    const overlays = this.getEffectiveOverlays(baseName);

    if (overlays.length === 0) {
      throw new Error(`adf-graph: no overlays configured for environment '${baseName}'`);
    }

    const existing = this.graphs.get(mergedName);
    if (existing && !existing.staleness.isStale()) {
      return { graph: existing.graph, warnings: existing.warnings, buildTimeMs: existing.buildTimeMs };
    }

    // Build base first
    const baseResult = this.ensureGraph(baseName);
    const start = Date.now();

    // Clone base and apply overlays
    const merged = baseResult.graph.clone();
    const warnings = [...baseResult.warnings];

    for (const overlayPath of overlays) {
      const scanResult = scanOverlayPath(overlayPath);
      warnings.push(...scanResult.warnings);
      // Build a temporary graph from the scan result
      const overlayGraph = new Graph();
      for (const node of scanResult.nodes) {
        overlayGraph.addNode(node);
      }
      for (const edge of scanResult.edges) {
        overlayGraph.addEdge(edge);
      }
      mergeOverlayInto(merged, overlayGraph);
    }

    const buildTimeMs = baseResult.buildTimeMs + (Date.now() - start);

    // Staleness checker watches base + all overlay paths
    const envConfig = this.getEnvConfig(baseName)!;
    const allPaths = [envConfig.path, ...overlays];
    const staleness = existing?.staleness ?? new StalenessChecker(allPaths);
    staleness.markBuilt();

    this.graphs.set(mergedName, { graph: merged, warnings, buildTimeMs, staleness });

    return { graph: merged, warnings, buildTimeMs };
  }

  private getEnvConfig(name: string): EnvironmentConfig | undefined {
    const configEnv = this.config.environments[name];
    if (configEnv) return configEnv;
    const runtimeEnv = this.runtimeEnvs.get(name);
    if (runtimeEnv) return { path: runtimeEnv.path };
    return undefined;
  }

  private getEffectiveOverlays(baseName: string): string[] {
    const configOverlays = this.config.environments[baseName]?.overlays ?? [];
    const runtimeOvls = this.runtimeOverlays.get(baseName) ?? [];
    return [...configOverlays, ...runtimeOvls];
  }

  private resolveBaseDefault(): string {
    // Config envs with default: true
    for (const [name, cfg] of Object.entries(this.config.environments)) {
      if (cfg.default) return name;
    }
    // Fall back to first config env
    const first = Object.keys(this.config.environments)[0];
    if (first) return first;
    // Fall back to first runtime env
    const firstRuntime = this.runtimeEnvs.keys().next().value;
    if (firstRuntime) return firstRuntime;
    throw new Error("adf-graph: no environments defined");
  }

  private allEnvironmentNames(): string[] {
    const names = [...Object.keys(this.config.environments), ...this.runtimeEnvs.keys()];
    // Add merged view names for envs with overlays
    for (const name of [...names]) {
      if (this.getEffectiveOverlays(name).length > 0) {
        names.push(name + OVERLAY_SUFFIX);
      }
    }
    return names;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/graph/manager.test.ts`
Expected: ALL PASS (new tests and existing tests)

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/graph/manager.ts tests/graph/manager.test.ts
git commit -m "feat: GraphManager overlay-aware build with merged views"
```

---

### Task 8: Runtime overlay management tools

**Files:**
- Create: `src/tools/addOverlay.ts`
- Create: `src/tools/removeOverlay.ts`
- Create: `src/tools/listOverlays.ts`
- Create: `tests/tools/addOverlay.test.ts`
- Create: `tests/tools/removeOverlay.test.ts`
- Create: `tests/tools/listOverlays.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write the tests for addOverlay handler**

Create `tests/tools/addOverlay.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import type { AdfGraphConfig } from "../../src/config.js";
import { handleAddOverlay } from "../../src/tools/addOverlay.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const overlayDir = join(fixtureRoot, "overlay-structured");

function makeConfig(envs: AdfGraphConfig["environments"]): AdfGraphConfig {
  return { environments: envs };
}

describe("handleAddOverlay", () => {
  it("adds a runtime overlay and returns the overlay list", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot, default: true } }));
    const result = handleAddOverlay(mgr, "main", overlayDir);
    expect(result.added).toBe(true);
    expect(result.overlays).toHaveLength(1);
    expect(result.overlays[0]).toEqual({ path: overlayDir, source: "runtime" });
  });

  it("returns error for unknown environment", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    expect(() => handleAddOverlay(mgr, "nope", overlayDir)).toThrow(/unknown environment/);
  });
});
```

- [ ] **Step 2: Write the tests for removeOverlay handler**

Create `tests/tools/removeOverlay.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import type { AdfGraphConfig } from "../../src/config.js";
import { handleRemoveOverlay } from "../../src/tools/removeOverlay.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const overlayDir = join(fixtureRoot, "overlay-structured");

function makeConfig(envs: AdfGraphConfig["environments"]): AdfGraphConfig {
  return { environments: envs };
}

describe("handleRemoveOverlay", () => {
  it("removes a runtime overlay", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    mgr.addOverlay("main", overlayDir);
    const result = handleRemoveOverlay(mgr, "main", overlayDir);
    expect(result.removed).toBe(true);
  });

  it("rejects removal of config-based overlay", () => {
    const mgr = new GraphManager(makeConfig({
      main: { path: fixtureRoot, overlays: [overlayDir] },
    }));
    const result = handleRemoveOverlay(mgr, "main", overlayDir);
    expect(result.removed).toBe(false);
    expect(result.error).toMatch(/config-based/);
  });
});
```

- [ ] **Step 3: Write the tests for listOverlays handler**

Create `tests/tools/listOverlays.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import type { AdfGraphConfig } from "../../src/config.js";
import { handleListOverlays } from "../../src/tools/listOverlays.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const overlayDir = join(fixtureRoot, "overlay-structured");

function makeConfig(envs: AdfGraphConfig["environments"]): AdfGraphConfig {
  return { environments: envs };
}

describe("handleListOverlays", () => {
  it("lists config and runtime overlays together", () => {
    const mgr = new GraphManager(makeConfig({
      main: { path: fixtureRoot, overlays: ["/config/path"] },
    }));
    mgr.addOverlay("main", overlayDir);
    const result = handleListOverlays(mgr, "main");
    expect(result.overlays).toHaveLength(2);
    expect(result.overlays[0]).toEqual({ path: "/config/path", source: "config" });
    expect(result.overlays[1]).toEqual({ path: overlayDir, source: "runtime" });
  });

  it("returns empty list when no overlays", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    const result = handleListOverlays(mgr, "main");
    expect(result.overlays).toHaveLength(0);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/tools/addOverlay.test.ts tests/tools/removeOverlay.test.ts tests/tools/listOverlays.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 5: Implement tool handlers**

Create `src/tools/addOverlay.ts`:

```typescript
import { GraphManager } from "../graph/manager.js";

export interface AddOverlayResult {
  added: boolean;
  environment: string;
  path: string;
  overlays: Array<{ path: string; source: "config" | "runtime" }>;
}

export function handleAddOverlay(
  manager: GraphManager,
  environment: string,
  path: string,
): AddOverlayResult {
  // Verify environment exists
  const envs = manager.listEnvironments();
  const baseEnv = envs.find((e) => e.name === environment && e.source !== "derived");
  if (!baseEnv) {
    throw new Error(`adf-graph: unknown environment '${environment}'`);
  }

  manager.addOverlay(environment, path);
  const overlays = manager.listOverlays(environment);

  return { added: true, environment, path, overlays };
}
```

Create `src/tools/removeOverlay.ts`:

```typescript
import { GraphManager } from "../graph/manager.js";

export interface RemoveOverlayResult {
  removed: boolean;
  environment: string;
  path: string;
  error?: string;
  overlays: Array<{ path: string; source: "config" | "runtime" }>;
}

export function handleRemoveOverlay(
  manager: GraphManager,
  environment: string,
  path: string,
): RemoveOverlayResult {
  const { removed, isConfigOverlay } = manager.removeOverlay(environment, path);

  if (isConfigOverlay) {
    return {
      removed: false,
      environment,
      path,
      error: `Cannot remove config-based overlay '${path}'. Edit adf-graph.json to remove it.`,
      overlays: manager.listOverlays(environment),
    };
  }

  return {
    removed,
    environment,
    path,
    overlays: manager.listOverlays(environment),
  };
}
```

Create `src/tools/listOverlays.ts`:

```typescript
import { GraphManager } from "../graph/manager.js";

export interface ListOverlaysResult {
  environment: string;
  overlays: Array<{ path: string; source: "config" | "runtime" }>;
}

export function handleListOverlays(
  manager: GraphManager,
  environment: string,
): ListOverlaysResult {
  return {
    environment,
    overlays: manager.listOverlays(environment),
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/tools/addOverlay.test.ts tests/tools/removeOverlay.test.ts tests/tools/listOverlays.test.ts`
Expected: ALL PASS

- [ ] **Step 7: Commit**

```bash
git add src/tools/addOverlay.ts src/tools/removeOverlay.ts src/tools/listOverlays.ts tests/tools/addOverlay.test.ts tests/tools/removeOverlay.test.ts tests/tools/listOverlays.test.ts
git commit -m "feat: add overlay management tool handlers"
```

---

### Task 9: Runtime environment management tools

**Files:**
- Create: `src/tools/addEnvironment.ts`
- Create: `src/tools/removeEnvironment.ts`
- Create: `tests/tools/addEnvironment.test.ts`
- Create: `tests/tools/removeEnvironment.test.ts`

- [ ] **Step 1: Write the tests for addEnvironment**

Create `tests/tools/addEnvironment.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import type { AdfGraphConfig } from "../../src/config.js";
import { handleAddEnvironment } from "../../src/tools/addEnvironment.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

function makeConfig(envs: AdfGraphConfig["environments"]): AdfGraphConfig {
  return { environments: envs };
}

describe("handleAddEnvironment", () => {
  it("adds a runtime environment", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    const result = handleAddEnvironment(mgr, "new-env", fixtureRoot);
    expect(result.added).toBe(true);
    expect(result.name).toBe("new-env");

    const envs = mgr.listEnvironments();
    expect(envs.find((e) => e.name === "new-env")).toBeDefined();
  });

  it("rejects name collision with config env", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    expect(() => handleAddEnvironment(mgr, "main", "/other")).toThrow(/conflicts/);
  });

  it("rejects names containing +", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    expect(() => handleAddEnvironment(mgr, "bad+name", "/path")).toThrow(/cannot contain/);
  });

  it("adds environment with overlays", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    const overlayDir = join(fixtureRoot, "overlay-structured");
    handleAddEnvironment(mgr, "with-overlays", fixtureRoot, [overlayDir]);

    const overlays = mgr.listOverlays("with-overlays");
    expect(overlays).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Write the tests for removeEnvironment**

Create `tests/tools/removeEnvironment.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import type { AdfGraphConfig } from "../../src/config.js";
import { handleRemoveEnvironment } from "../../src/tools/removeEnvironment.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

function makeConfig(envs: AdfGraphConfig["environments"]): AdfGraphConfig {
  return { environments: envs };
}

describe("handleRemoveEnvironment", () => {
  it("removes a runtime environment", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    mgr.addEnvironment("temp", fixtureRoot);
    const result = handleRemoveEnvironment(mgr, "temp");
    expect(result.removed).toBe(true);

    const envs = mgr.listEnvironments();
    expect(envs.find((e) => e.name === "temp")).toBeUndefined();
  });

  it("rejects removal of config-based environment", () => {
    const mgr = new GraphManager(makeConfig({ main: { path: fixtureRoot } }));
    const result = handleRemoveEnvironment(mgr, "main");
    expect(result.removed).toBe(false);
    expect(result.error).toMatch(/config-based/);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/tools/addEnvironment.test.ts tests/tools/removeEnvironment.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 4: Implement tool handlers**

Create `src/tools/addEnvironment.ts`:

```typescript
import { GraphManager } from "../graph/manager.js";

export interface AddEnvironmentResult {
  added: boolean;
  name: string;
  path: string;
}

export function handleAddEnvironment(
  manager: GraphManager,
  name: string,
  path: string,
  overlays?: string[],
): AddEnvironmentResult {
  manager.addEnvironment(name, path, overlays);
  return { added: true, name, path };
}
```

Create `src/tools/removeEnvironment.ts`:

```typescript
import { GraphManager } from "../graph/manager.js";

export interface RemoveEnvironmentResult {
  removed: boolean;
  name: string;
  error?: string;
}

export function handleRemoveEnvironment(
  manager: GraphManager,
  name: string,
): RemoveEnvironmentResult {
  const { removed, isConfigEnv } = manager.removeEnvironment(name);

  if (isConfigEnv) {
    return {
      removed: false,
      name,
      error: `Cannot remove config-based environment '${name}'. Edit adf-graph.json to remove it.`,
    };
  }

  return { removed, name };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/tools/addEnvironment.test.ts tests/tools/removeEnvironment.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/addEnvironment.ts src/tools/removeEnvironment.ts tests/tools/addEnvironment.test.ts tests/tools/removeEnvironment.test.ts
git commit -m "feat: add environment management tool handlers"
```

---

### Task 10: Register new tools in server.ts

**Files:**
- Modify: `src/server.ts`

- [ ] **Step 1: Add imports and tool registrations**

Add imports at the top of `src/server.ts` (after existing imports):

```typescript
import { handleAddOverlay } from "./tools/addOverlay.js";
import { handleRemoveOverlay } from "./tools/removeOverlay.js";
import { handleListOverlays } from "./tools/listOverlays.js";
import { handleAddEnvironment } from "./tools/addEnvironment.js";
import { handleRemoveEnvironment } from "./tools/removeEnvironment.js";
```

Add tool registrations after the existing `graph_list_environments` tool (before the transport lines):

```typescript
// Tool 8: graph_add_overlay
server.tool(
  "graph_add_overlay",
  "Add an overlay path (directory or file) to an environment. The overlay's artifacts are merged on top of the base graph in a separate merged view. Runtime overlays are ephemeral (lost on restart).",
  {
    environment: z.string().describe("Base environment name to overlay onto"),
    path: z.string().describe("Path to overlay directory or file"),
  },
  async ({ environment, path }) => {
    const result = handleAddOverlay(manager, environment, path);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 9: graph_remove_overlay
server.tool(
  "graph_remove_overlay",
  "Remove a runtime overlay from an environment. Config-based overlays cannot be removed via this tool.",
  {
    environment: z.string().describe("Environment name"),
    path: z.string().describe("Overlay path to remove"),
  },
  async ({ environment, path }) => {
    const result = handleRemoveOverlay(manager, environment, path);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 10: graph_list_overlays
server.tool(
  "graph_list_overlays",
  "List all overlays (config-based and runtime) for an environment.",
  {
    environment: environmentParam,
  },
  async ({ environment }) => {
    const envName = environment ?? manager.getDefaultEnvironment().replace("+overlays", "");
    const result = handleListOverlays(manager, envName);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 11: graph_add_environment
server.tool(
  "graph_add_environment",
  "Register a new ephemeral environment pointing to an ADF artifact directory. Lost on server restart. Cannot collide with config-based environment names.",
  {
    name: z.string().describe("Environment name (cannot contain '+')"),
    path: z.string().describe("Path to ADF artifact root directory"),
    overlays: z
      .array(z.string())
      .optional()
      .describe("Optional overlay paths to apply to this environment"),
  },
  async ({ name, path, overlays }) => {
    const result = handleAddEnvironment(manager, name, path, overlays);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 12: graph_remove_environment
server.tool(
  "graph_remove_environment",
  "Remove a runtime environment. Config-based environments cannot be removed via this tool.",
  {
    name: z.string().describe("Environment name to remove"),
  },
  async ({ name }) => {
    const result = handleRemoveEnvironment(manager, name);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);
```

- [ ] **Step 2: Build to verify no compilation errors**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add src/server.ts
git commit -m "feat: register overlay and environment management MCP tools"
```

---

### Task 11: Update listEnvironments tool response

The existing `graph_list_environments` tool in `server.ts` already calls `manager.listEnvironments()`, which now returns the new `source` and `hasOverlays` fields. No code change needed — the new fields are automatically included in the JSON response.

**Files:**
- Modify: `tests/tools/listEnvironments.test.ts` (if it exists — need to verify it tests the new fields)

- [ ] **Step 1: Check if dedicated listEnvironments test exists**

The `graph_list_environments` tool is defined inline in `server.ts` with no separate handler file. The existing test coverage in `tests/graph/manager.test.ts` (Task 7) already validates `source` and `hasOverlays` fields on the `listEnvironments()` output. No additional test file needed.

- [ ] **Step 2: Verify by running full suite**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 3: Commit (skip if no changes)**

No commit needed — Task 7 already covers this.

---

### Task 12: Update CLAUDE.md and server.json

**Files:**
- Modify: `CLAUDE.md`
- Modify: `server.json`

- [ ] **Step 1: Update CLAUDE.md**

Add to the Architecture section:

```markdown
- `src/graph/overlay.ts` — Artifact type detection, overlay scanning (structured + loose), graph merge
```

Add to the Configuration section, under the multi-environment example:

```markdown
### Overlays

Environments can have an optional `overlays` array to layer local/in-progress files on top:

\`\`\`json
{
  "environments": {
    "work-repo": {
      "path": "C:/repos/adf-main",
      "default": true,
      "overlays": ["C:/my-wip/", "C:/one-off/NewPipeline.json"]
    }
  }
}
\`\`\`

- Overlay directories with ADF structure (`pipeline/`, `dataset/`) are parsed normally.
- Loose files are auto-detected by inspecting JSON content.
- The base graph stays clean; a merged view appears as `{name}+overlays`.
- Runtime overlays can be added/removed via MCP tools (`graph_add_overlay`, `graph_remove_overlay`).
- Runtime environments can be registered via `graph_add_environment`.
```

- [ ] **Step 2: Update server.json with new tools**

Add the five new tools to the `server.json` tools array. Check the existing format first and match it.

- [ ] **Step 3: Build final**

Run: `npm run build`
Expected: Clean build, no errors

- [ ] **Step 4: Run full test suite one last time**

Run: `npx vitest run`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md server.json
git commit -m "docs: update CLAUDE.md and server.json for overlay support"
```
