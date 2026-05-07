# boomerang-graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new MCP server that deeply indexes SQL database objects and Dataverse entity metadata from the boomerang ecosystem, providing agents with structured, relationship-rich answers instead of raw file search.

**Architecture:** A standalone TypeScript MCP server (`boomerang-graph`) following the same patterns as `adf-graph` — graph model with adjacency lists, multi-environment manager with lazy builds, mtime-based staleness, and one-file-per-tool registration. Parsers use a 6-pass approach: two eager index scans (SQL `_index.json` and Dataverse `_index.json`) plus four lazy deep-parse passes (SP bodies, table DDL, view definitions, entity files). Cross-references to adf-graph are embedded as structured `see_also` fields in tool responses.

**Tech Stack:** TypeScript, Node.js ≥18, `@modelcontextprotocol/sdk` ^1.29.0, Zod ^4.3.6, Vitest ^3.2.0

**Spec:** `docs/superpowers/specs/2026-05-07-boomerang-graph-design.md` (in adf-graph repo)

**New repo location:** `C:\Users\shurley\source\repos\HurleySk\boomerang-graph`

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `server.json`

- [ ] **Step 1: Initialize the repository**

```bash
cd C:\Users\shurley\source\repos\HurleySk
mkdir boomerang-graph && cd boomerang-graph
git init
```

- [ ] **Step 2: Create package.json**

```json
{
  "name": "boomerang-graph",
  "version": "0.1.0",
  "description": "MCP server that builds a queryable dependency graph from SQL and Dataverse schema artifacts",
  "license": "MIT",
  "author": "HurleySk",
  "engines": {
    "node": ">=18"
  },
  "type": "module",
  "bin": {
    "boomerang-graph": "dist/server.js"
  },
  "main": "dist/server.js",
  "files": [
    "dist",
    "README.md",
    "server.json"
  ],
  "scripts": {
    "prebuild": "rm -rf dist",
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "tsc --watch",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^4.3.6"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.5.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"] },
});
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
*.tgz
.npmrc
```

- [ ] **Step 6: Create server.json** (MCP manifest)

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "boomerang-graph",
  "version": "0.1.0",
  "description": "MCP server for deep SQL and Dataverse schema indexing with cross-references to adf-graph",
  "tools": []
}
```

- [ ] **Step 7: Install dependencies**

```bash
npm install
```

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore server.json
git commit -m "feat: project scaffold"
```

---

### Task 2: Graph Model

**Files:**
- Create: `src/graph/model.ts`

- [ ] **Step 1: Write the test**

Create `tests/graph/model.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { Graph, NodeType, EdgeType } from "../../src/graph/model.js";

describe("Graph", () => {
  function buildTestGraph(): Graph {
    const g = new Graph();
    g.addNode({ id: "sp:dbo.p_Test", type: NodeType.SqlProcedure, name: "p_Test", metadata: {} });
    g.addNode({ id: "table:dbo.Staging", type: NodeType.SqlTable, name: "Staging", metadata: {} });
    g.addNode({ id: "table:dbo.Log", type: NodeType.SqlTable, name: "Log", metadata: {} });
    g.addEdge({ from: "sp:dbo.p_Test", to: "table:dbo.Staging", type: EdgeType.WritesTo, metadata: {} });
    g.addEdge({ from: "sp:dbo.p_Test", to: "table:dbo.Log", type: EdgeType.ReadsFrom, metadata: {} });
    return g;
  }

  it("stores and retrieves nodes", () => {
    const g = buildTestGraph();
    const node = g.getNode("sp:dbo.p_Test");
    expect(node).toBeDefined();
    expect(node!.name).toBe("p_Test");
    expect(node!.type).toBe(NodeType.SqlProcedure);
  });

  it("tracks outgoing and incoming edges", () => {
    const g = buildTestGraph();
    const out = g.getOutgoing("sp:dbo.p_Test");
    expect(out).toHaveLength(2);
    const inc = g.getIncoming("table:dbo.Staging");
    expect(inc).toHaveLength(1);
    expect(inc[0].from).toBe("sp:dbo.p_Test");
  });

  it("filters nodes by type", () => {
    const g = buildTestGraph();
    const tables = g.getNodesByType(NodeType.SqlTable);
    expect(tables).toHaveLength(2);
  });

  it("computes stats", () => {
    const g = buildTestGraph();
    const stats = g.stats();
    expect(stats.nodeCount).toBe(3);
    expect(stats.edgeCount).toBe(2);
    expect(stats.nodesByType[NodeType.SqlProcedure]).toBe(1);
    expect(stats.nodesByType[NodeType.SqlTable]).toBe(2);
  });

  it("traverses downstream", () => {
    const g = buildTestGraph();
    const results = g.traverseDownstream("sp:dbo.p_Test");
    expect(results).toHaveLength(2);
    const names = results.map((r) => r.node.name);
    expect(names).toContain("Staging");
    expect(names).toContain("Log");
  });

  it("traverses upstream", () => {
    const g = buildTestGraph();
    const results = g.traverseUpstream("table:dbo.Staging");
    expect(results).toHaveLength(1);
    expect(results[0].node.name).toBe("p_Test");
  });

  it("finds paths between nodes", () => {
    const g = buildTestGraph();
    const paths = g.findPaths("sp:dbo.p_Test", "table:dbo.Staging");
    expect(paths).toHaveLength(1);
    expect(paths[0]).toHaveLength(1);
    expect(paths[0][0].type).toBe(EdgeType.WritesTo);
  });

  it("respects maxDepth in traversal", () => {
    const g = new Graph();
    g.addNode({ id: "a", type: NodeType.SqlProcedure, name: "a", metadata: {} });
    g.addNode({ id: "b", type: NodeType.SqlProcedure, name: "b", metadata: {} });
    g.addNode({ id: "c", type: NodeType.SqlProcedure, name: "c", metadata: {} });
    g.addEdge({ from: "a", to: "b", type: EdgeType.Calls, metadata: {} });
    g.addEdge({ from: "b", to: "c", type: EdgeType.Calls, metadata: {} });
    const results = g.traverseDownstream("a", 1);
    expect(results).toHaveLength(1);
    expect(results[0].node.name).toBe("b");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/graph/model.test.ts
```

Expected: FAIL — `src/graph/model.js` does not exist.

- [ ] **Step 3: Implement the graph model**

Create `src/graph/model.ts`:

```typescript
export enum NodeType {
  SqlTable = "sql_table",
  SqlProcedure = "sql_procedure",
  SqlView = "sql_view",
  SqlFunction = "sql_function",
  DvEntity = "dv_entity",
  DvAttribute = "dv_attribute",
}

export enum EdgeType {
  Calls = "calls",
  ReadsFrom = "reads_from",
  WritesTo = "writes_to",
  References = "references",
  CallsFunction = "calls_function",
  ForeignKey = "foreign_key",
  ViewReads = "view_reads",
  HasAttribute = "has_attribute",
  LookupTo = "lookup_to",
}

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  metadata: Record<string, unknown>;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: EdgeType;
  metadata: Record<string, unknown>;
}

export interface TraversalResult {
  node: GraphNode;
  path: GraphEdge[];
  depth: number;
}

export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  nodesByType: Partial<Record<NodeType, number>>;
  edgesByType: Partial<Record<EdgeType, number>>;
}

export class Graph {
  private nodes: Map<string, GraphNode> = new Map();
  private outgoing: Map<string, GraphEdge[]> = new Map();
  private incoming: Map<string, GraphEdge[]> = new Map();

  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (!this.outgoing.has(node.id)) this.outgoing.set(node.id, []);
    if (!this.incoming.has(node.id)) this.incoming.set(node.id, []);
  }

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  addEdge(edge: GraphEdge): void {
    if (!this.outgoing.has(edge.from)) this.outgoing.set(edge.from, []);
    if (!this.incoming.has(edge.to)) this.incoming.set(edge.to, []);
    this.outgoing.get(edge.from)!.push(edge);
    this.incoming.get(edge.to)!.push(edge);
  }

  getOutgoing(id: string): GraphEdge[] {
    return this.outgoing.get(id) ?? [];
  }

  getIncoming(id: string): GraphEdge[] {
    return this.incoming.get(id) ?? [];
  }

  getNodesByType(type: NodeType): GraphNode[] {
    const result: GraphNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.type === type) result.push(node);
    }
    return result;
  }

  stats(): GraphStats {
    const nodesByType: Partial<Record<NodeType, number>> = {};
    for (const node of this.nodes.values()) {
      nodesByType[node.type] = (nodesByType[node.type] ?? 0) + 1;
    }
    const edgesByType: Partial<Record<EdgeType, number>> = {};
    let edgeCount = 0;
    for (const edges of this.outgoing.values()) {
      for (const edge of edges) {
        edgesByType[edge.type] = (edgesByType[edge.type] ?? 0) + 1;
        edgeCount++;
      }
    }
    return { nodeCount: this.nodes.size, edgeCount, nodesByType, edgesByType };
  }

  traverseDownstream(startId: string, maxDepth?: number): TraversalResult[] {
    return this.bfs(startId, "downstream", maxDepth);
  }

  traverseUpstream(startId: string, maxDepth?: number): TraversalResult[] {
    return this.bfs(startId, "upstream", maxDepth);
  }

  findPaths(fromId: string, toId: string, maxDepth = 20): GraphEdge[][] {
    const results: GraphEdge[][] = [];
    const dfs = (current: string, path: GraphEdge[], visited: Set<string>) => {
      if (current === toId && path.length > 0) {
        results.push([...path]);
        return;
      }
      if (path.length >= maxDepth) return;
      for (const edge of this.getOutgoing(current)) {
        if (visited.has(edge.to)) continue;
        visited.add(edge.to);
        path.push(edge);
        dfs(edge.to, path, visited);
        path.pop();
        visited.delete(edge.to);
      }
    };
    dfs(fromId, [], new Set([fromId]));
    return results;
  }

  allNodes(): GraphNode[] {
    return Array.from(this.nodes.values());
  }

  allEdges(): GraphEdge[] {
    const edges: GraphEdge[] = [];
    for (const edgeList of this.outgoing.values()) {
      edges.push(...edgeList);
    }
    return edges;
  }

  private bfs(startId: string, direction: "downstream" | "upstream", maxDepth?: number): TraversalResult[] {
    const results: TraversalResult[] = [];
    const visited = new Set<string>([startId]);
    const queue: Array<{ id: string; path: GraphEdge[]; depth: number }> = [
      { id: startId, path: [], depth: 0 },
    ];
    while (queue.length > 0) {
      const { id, path, depth } = queue.shift()!;
      const edges = direction === "downstream" ? this.getOutgoing(id) : this.getIncoming(id);
      for (const edge of edges) {
        const nextId = direction === "downstream" ? edge.to : edge.from;
        if (visited.has(nextId)) continue;
        visited.add(nextId);
        const nextPath = [...path, edge];
        const nextDepth = depth + 1;
        const node = this.nodes.get(nextId);
        if (node) results.push({ node, path: nextPath, depth: nextDepth });
        if (maxDepth === undefined || nextDepth < maxDepth) {
          queue.push({ id: nextId, path: nextPath, depth: nextDepth });
        }
      }
    }
    return results;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/graph/model.test.ts
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/graph/model.ts tests/graph/model.test.ts
git commit -m "feat: graph model with node types, edge types, traversal"
```

---

### Task 3: Node ID Utilities + ParseResult

**Files:**
- Create: `src/utils/nodeId.ts`
- Create: `src/parsers/parseResult.ts`

- [ ] **Step 1: Write the test**

Create `tests/utils/nodeId.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  makeTableId, makeSpId, makeViewId, makeFunctionId,
  makeEntityId, makeAttributeId, parseNodeId,
} from "../../src/utils/nodeId.js";

describe("nodeId", () => {
  it("creates SQL table IDs", () => {
    expect(makeTableId("dbo", "ADFLog")).toBe("table:dbo.ADFLog");
  });

  it("creates SP IDs", () => {
    expect(makeSpId("dbo", "p_Test_Transform")).toBe("sp:dbo.p_Test_Transform");
  });

  it("creates view IDs", () => {
    expect(makeViewId("dbo", "vw_Test")).toBe("view:dbo.vw_Test");
  });

  it("creates function IDs", () => {
    expect(makeFunctionId("dbo", "fnFirsties")).toBe("func:dbo.fnFirsties");
  });

  it("creates entity IDs", () => {
    expect(makeEntityId("alm_organization")).toBe("entity:alm_organization");
  });

  it("creates attribute IDs", () => {
    expect(makeAttributeId("alm_organization", "alm_name")).toBe("attr:alm_organization.alm_name");
  });

  it("parses node IDs back to components", () => {
    const result = parseNodeId("sp:dbo.p_Test_Transform");
    expect(result.prefix).toBe("sp");
    expect(result.qualifiedName).toBe("dbo.p_Test_Transform");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/utils/nodeId.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement nodeId.ts**

Create `src/utils/nodeId.ts`:

```typescript
export function makeTableId(schema: string, name: string): string {
  return `table:${schema}.${name}`;
}

export function makeSpId(schema: string, name: string): string {
  return `sp:${schema}.${name}`;
}

export function makeViewId(schema: string, name: string): string {
  return `view:${schema}.${name}`;
}

export function makeFunctionId(schema: string, name: string): string {
  return `func:${schema}.${name}`;
}

export function makeEntityId(logicalName: string): string {
  return `entity:${logicalName}`;
}

export function makeAttributeId(entityName: string, attrName: string): string {
  return `attr:${entityName}.${attrName}`;
}

export function parseNodeId(id: string): { prefix: string; qualifiedName: string } {
  const colonIdx = id.indexOf(":");
  if (colonIdx === -1) return { prefix: "", qualifiedName: id };
  return { prefix: id.slice(0, colonIdx), qualifiedName: id.slice(colonIdx + 1) };
}
```

- [ ] **Step 4: Create parseResult.ts**

Create `src/parsers/parseResult.ts`:

```typescript
import type { GraphNode, GraphEdge } from "../graph/model.js";

export interface ParseResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
}
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run tests/utils/nodeId.test.ts
```

Expected: All 7 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/utils/nodeId.ts src/parsers/parseResult.ts tests/utils/nodeId.test.ts
git commit -m "feat: node ID utilities and ParseResult type"
```

---

### Task 4: Test Fixtures

**Files:**
- Create: `tests/fixtures/db-export/testenv/_index.json`
- Create: `tests/fixtures/db-export/testenv/procedure/dbo.p_Test_Transform.sql`
- Create: `tests/fixtures/db-export/testenv/procedure/dbo.p_Batch_Process.sql`
- Create: `tests/fixtures/db-export/testenv/table/dbo.TestStaging.sql`
- Create: `tests/fixtures/db-export/testenv/table/dbo.ADFLog.sql`
- Create: `tests/fixtures/db-export/testenv/view/dbo.vw_ActiveRecords.sql`
- Create: `tests/fixtures/db-export/testenv/function/dbo.fnFormatName.sql`
- Create: `tests/fixtures/dataverse-schema/testenv/_index.json`
- Create: `tests/fixtures/dataverse-schema/testenv/alm_testentity.json`
- Create: `tests/fixtures/dataverse-schema/testenv/alm_relatedentity.json`

- [ ] **Step 1: Create SQL _index.json fixture**

Create `tests/fixtures/db-export/testenv/_index.json`:

```json
{
  "generated": "2026-05-01T00:00:00Z",
  "connection": "testenv",
  "tableCount": 2,
  "storedProcedureCount": 2,
  "viewCount": 1,
  "functionCount": 1,
  "tables": [
    {
      "name": "TestStaging",
      "schema": "dbo",
      "file": "table/dbo.TestStaging.sql",
      "columnCount": 4,
      "columns": [
        { "name": "Id", "type": "INT", "nullable": false },
        { "name": "Name", "type": "NVARCHAR (200)", "nullable": false },
        { "name": "StatusCode", "type": "INT", "nullable": true },
        { "name": "copy_flag", "type": "BIT", "nullable": true }
      ]
    },
    {
      "name": "ADFLog",
      "schema": "dbo",
      "file": "table/dbo.ADFLog.sql",
      "columnCount": 3,
      "columns": [
        { "name": "ADFLogId", "type": "BIGINT", "nullable": false },
        { "name": "ADFRunId", "type": "NVARCHAR (200)", "nullable": false },
        { "name": "ADFRunName", "type": "NVARCHAR (200)", "nullable": false }
      ]
    }
  ],
  "storedProcedures": [
    { "name": "p_Test_Transform", "schema": "dbo", "file": "procedure/dbo.p_Test_Transform.sql" },
    { "name": "p_Batch_Process", "schema": "dbo", "file": "procedure/dbo.p_Batch_Process.sql" }
  ],
  "views": [
    { "name": "vw_ActiveRecords", "schema": "dbo", "file": "view/dbo.vw_ActiveRecords.sql" }
  ],
  "functions": [
    { "name": "fnFormatName", "schema": "dbo", "file": "function/dbo.fnFormatName.sql" }
  ]
}
```

- [ ] **Step 2: Create SQL procedure fixtures**

Create `tests/fixtures/db-export/testenv/procedure/dbo.p_Test_Transform.sql`:

```sql
CREATE PROCEDURE [dbo].[p_Test_Transform]
(
    @BatchSize INT = 1000
)
AS
BEGIN
    INSERT INTO [dbo].[TestStaging] (Id, Name, StatusCode, copy_flag)
    SELECT Id, dbo.fnFormatName(Name), StatusCode, 1
    FROM [dbo].[ADFLog]
    WHERE ADFRunId IS NOT NULL;

    EXEC [dbo].[p_Batch_Process] @querykeys = '1,2,3', @key_col = 'Id',
        @dest_schema_name = 'dbo', @dest_object_name = 'TestStaging', @key_type = 'INT';
END
```

Create `tests/fixtures/db-export/testenv/procedure/dbo.p_Batch_Process.sql`:

```sql
CREATE PROCEDURE [dbo].[p_Batch_Process]
(
    @querykeys NVARCHAR(MAX),
    @key_col NVARCHAR(50),
    @dest_schema_name NVARCHAR(20),
    @dest_object_name NVARCHAR(200),
    @key_type NVARCHAR(20)
)
AS
BEGIN
    DECLARE @full_table_name NVARCHAR(MAX) = CONCAT(@dest_schema_name, N'.temp_', @dest_object_name);

    SELECT @sqlcolumn = COALESCE(@sqlcolumn + ', ', '') + QUOTENAME([Name])
    FROM sys.columns sc
    WHERE sc.OBJECT_ID = OBJECT_ID(@full_table_name, N'u');

    EXEC sp_executesql @sqlquery
END
```

- [ ] **Step 3: Create SQL table fixtures**

Create `tests/fixtures/db-export/testenv/table/dbo.TestStaging.sql`:

```sql
CREATE TABLE [dbo].[TestStaging] (
    [Id] INT NOT NULL,
    [Name] NVARCHAR (200) NOT NULL,
    [StatusCode] INT NULL,
    [copy_flag] BIT NULL,
    CONSTRAINT [PK_TestStaging] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [FK_TestStaging_ADFLog] FOREIGN KEY ([Id]) REFERENCES [dbo].[ADFLog] ([ADFLogId])
);
```

Create `tests/fixtures/db-export/testenv/table/dbo.ADFLog.sql`:

```sql
CREATE TABLE [dbo].[ADFLog] (
    [ADFLogId] BIGINT IDENTITY (1, 1) NOT NULL,
    [ADFRunId] NVARCHAR (200) NOT NULL,
    [ADFRunName] NVARCHAR (200) NOT NULL,
    CONSTRAINT [PK_ADFLog] PRIMARY KEY CLUSTERED ([ADFLogId] ASC)
);
```

- [ ] **Step 4: Create SQL view and function fixtures**

Create `tests/fixtures/db-export/testenv/view/dbo.vw_ActiveRecords.sql`:

```sql
CREATE VIEW [dbo].[vw_ActiveRecords]
AS
    SELECT ts.Id, ts.Name, ts.StatusCode
    FROM [dbo].[TestStaging] ts
    INNER JOIN [dbo].[ADFLog] al ON ts.Id = al.ADFLogId
    WHERE ts.copy_flag = 1;
```

Create `tests/fixtures/db-export/testenv/function/dbo.fnFormatName.sql`:

```sql
CREATE FUNCTION [dbo].[fnFormatName] (@name NVARCHAR(200))
RETURNS NVARCHAR(200)
AS
BEGIN
    RETURN UPPER(LTRIM(RTRIM(@name)));
END
```

- [ ] **Step 5: Create Dataverse _index.json fixture**

Create `tests/fixtures/dataverse-schema/testenv/_index.json`:

```json
{
  "generated": "2026-05-01T00:00:00Z",
  "entityCount": 2,
  "entities": [
    {
      "logicalName": "alm_testentity",
      "displayName": "Test Entity",
      "entitySetName": "alm_testentities",
      "primaryId": "alm_testentityid",
      "primaryName": "alm_name",
      "attributeCount": 4,
      "file": "alm_testentity.json",
      "attributes": "alm_testentityid, alm_name, alm_statuscode, alm_relatedentityid",
      "attributeDetails": [
        { "name": "alm_testentityid", "type": "Uniqueidentifier" },
        { "name": "alm_name", "type": "String" },
        { "name": "alm_statuscode", "type": "Picklist" },
        { "name": "alm_relatedentityid", "type": "Lookup" }
      ]
    },
    {
      "logicalName": "alm_relatedentity",
      "displayName": "Related Entity",
      "entitySetName": "alm_relatedentities",
      "primaryId": "alm_relatedentityid",
      "primaryName": "alm_title",
      "attributeCount": 2,
      "file": "alm_relatedentity.json",
      "attributes": "alm_relatedentityid, alm_title",
      "attributeDetails": [
        { "name": "alm_relatedentityid", "type": "Uniqueidentifier" },
        { "name": "alm_title", "type": "String" }
      ]
    }
  ]
}
```

- [ ] **Step 6: Create Dataverse entity fixtures**

Create `tests/fixtures/dataverse-schema/testenv/alm_testentity.json`:

```json
{
  "LogicalName": "alm_testentity",
  "SchemaName": "alm_TestEntity",
  "DisplayName": {
    "UserLocalizedLabel": { "Label": "Test Entity", "LanguageCode": 1033 }
  },
  "EntitySetName": "alm_testentities",
  "PrimaryIdAttribute": "alm_testentityid",
  "PrimaryNameAttribute": "alm_name",
  "Attributes": [
    {
      "@odata.type": "#Microsoft.Dynamics.CRM.UniqueIdentifierAttributeMetadata",
      "LogicalName": "alm_testentityid",
      "SchemaName": "alm_TestEntityId",
      "AttributeType": "Uniqueidentifier",
      "IsPrimaryId": true,
      "IsValidForCreate": true,
      "IsValidForRead": true,
      "IsValidForUpdate": false,
      "RequiredLevel": { "Value": "SystemRequired" },
      "DisplayName": { "UserLocalizedLabel": { "Label": "Test Entity ID", "LanguageCode": 1033 } }
    },
    {
      "@odata.type": "#Microsoft.Dynamics.CRM.StringAttributeMetadata",
      "LogicalName": "alm_name",
      "SchemaName": "alm_Name",
      "AttributeType": "String",
      "MaxLength": 200,
      "IsValidForCreate": true,
      "IsValidForRead": true,
      "IsValidForUpdate": true,
      "RequiredLevel": { "Value": "Recommended" },
      "IsCustomAttribute": true,
      "DisplayName": { "UserLocalizedLabel": { "Label": "Name", "LanguageCode": 1033 } }
    },
    {
      "@odata.type": "#Microsoft.Dynamics.CRM.PicklistAttributeMetadata",
      "LogicalName": "alm_statuscode",
      "SchemaName": "alm_StatusCode",
      "AttributeType": "Picklist",
      "IsValidForCreate": true,
      "IsValidForRead": true,
      "IsValidForUpdate": true,
      "RequiredLevel": { "Value": "None" },
      "IsCustomAttribute": true,
      "DisplayName": { "UserLocalizedLabel": { "Label": "Status", "LanguageCode": 1033 } },
      "OptionSet": {
        "Options": [
          { "Value": 1, "Label": { "UserLocalizedLabel": { "Label": "Active", "LanguageCode": 1033 } } },
          { "Value": 2, "Label": { "UserLocalizedLabel": { "Label": "Inactive", "LanguageCode": 1033 } } },
          { "Value": 3, "Label": { "UserLocalizedLabel": { "Label": "Archived", "LanguageCode": 1033 } } }
        ]
      }
    },
    {
      "@odata.type": "#Microsoft.Dynamics.CRM.LookupAttributeMetadata",
      "LogicalName": "alm_relatedentityid",
      "SchemaName": "alm_RelatedEntityId",
      "AttributeType": "Lookup",
      "IsValidForCreate": true,
      "IsValidForRead": true,
      "IsValidForUpdate": true,
      "RequiredLevel": { "Value": "None" },
      "IsCustomAttribute": true,
      "Targets": ["alm_relatedentity"],
      "DisplayName": { "UserLocalizedLabel": { "Label": "Related Entity", "LanguageCode": 1033 } }
    }
  ]
}
```

Create `tests/fixtures/dataverse-schema/testenv/alm_relatedentity.json`:

```json
{
  "LogicalName": "alm_relatedentity",
  "SchemaName": "alm_RelatedEntity",
  "DisplayName": {
    "UserLocalizedLabel": { "Label": "Related Entity", "LanguageCode": 1033 }
  },
  "EntitySetName": "alm_relatedentities",
  "PrimaryIdAttribute": "alm_relatedentityid",
  "PrimaryNameAttribute": "alm_title",
  "Attributes": [
    {
      "@odata.type": "#Microsoft.Dynamics.CRM.UniqueIdentifierAttributeMetadata",
      "LogicalName": "alm_relatedentityid",
      "SchemaName": "alm_RelatedEntityId",
      "AttributeType": "Uniqueidentifier",
      "IsPrimaryId": true,
      "IsValidForCreate": true,
      "IsValidForRead": true,
      "IsValidForUpdate": false,
      "RequiredLevel": { "Value": "SystemRequired" },
      "DisplayName": { "UserLocalizedLabel": { "Label": "Related Entity ID", "LanguageCode": 1033 } }
    },
    {
      "@odata.type": "#Microsoft.Dynamics.CRM.StringAttributeMetadata",
      "LogicalName": "alm_title",
      "SchemaName": "alm_Title",
      "AttributeType": "String",
      "MaxLength": 200,
      "IsValidForCreate": true,
      "IsValidForRead": true,
      "IsValidForUpdate": true,
      "RequiredLevel": { "Value": "Recommended" },
      "IsCustomAttribute": true,
      "DisplayName": { "UserLocalizedLabel": { "Label": "Title", "LanguageCode": 1033 } }
    }
  ]
}
```

- [ ] **Step 7: Commit**

```bash
git add tests/fixtures/
git commit -m "feat: test fixtures for SQL and Dataverse parsers"
```

---

### Task 5: SQL Index Parser (Pass 1)

**Files:**
- Create: `src/parsers/sqlIndex.ts`
- Create: `tests/parsers/sqlIndex.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/parsers/sqlIndex.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { join } from "path";
import { parseSqlIndex } from "../../src/parsers/sqlIndex.js";
import { NodeType } from "../../src/graph/model.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures/db-export/testenv");

describe("parseSqlIndex", () => {
  it("creates nodes for all SQL object types", () => {
    const result = parseSqlIndex(fixtureRoot);
    expect(result.warnings).toHaveLength(0);

    const tables = result.nodes.filter((n) => n.type === NodeType.SqlTable);
    expect(tables).toHaveLength(2);
    expect(tables.map((t) => t.name)).toContain("TestStaging");
    expect(tables.map((t) => t.name)).toContain("ADFLog");

    const sps = result.nodes.filter((n) => n.type === NodeType.SqlProcedure);
    expect(sps).toHaveLength(2);
    expect(sps.map((s) => s.name)).toContain("p_Test_Transform");

    const views = result.nodes.filter((n) => n.type === NodeType.SqlView);
    expect(views).toHaveLength(1);
    expect(views[0].name).toBe("vw_ActiveRecords");

    const funcs = result.nodes.filter((n) => n.type === NodeType.SqlFunction);
    expect(funcs).toHaveLength(1);
    expect(funcs[0].name).toBe("fnFormatName");
  });

  it("attaches column metadata to table nodes", () => {
    const result = parseSqlIndex(fixtureRoot);
    const staging = result.nodes.find((n) => n.name === "TestStaging")!;
    const columns = staging.metadata.columns as Array<{ name: string; type: string }>;
    expect(columns).toHaveLength(4);
    expect(columns[0].name).toBe("Id");
    expect(columns[0].type).toBe("INT");
  });

  it("attaches file paths to nodes", () => {
    const result = parseSqlIndex(fixtureRoot);
    const sp = result.nodes.find((n) => n.name === "p_Test_Transform")!;
    expect(sp.metadata.filePath).toContain("procedure/dbo.p_Test_Transform.sql");
  });

  it("returns warning for missing directory", () => {
    const result = parseSqlIndex("/nonexistent/path");
    expect(result.nodes).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/parsers/sqlIndex.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement sqlIndex.ts**

Create `src/parsers/sqlIndex.ts`:

```typescript
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { GraphNode } from "../graph/model.js";
import { NodeType } from "../graph/model.js";
import type { ParseResult } from "./parseResult.js";
import { makeTableId, makeSpId, makeViewId, makeFunctionId } from "../utils/nodeId.js";

interface ColumnEntry {
  name: string;
  type: string;
  nullable?: boolean;
}

interface TableEntry {
  name: string;
  schema: string;
  file: string;
  columnCount: number;
  columns: ColumnEntry[];
}

interface ObjectEntry {
  name: string;
  schema: string;
  file: string;
}

interface SqlIndex {
  tables?: TableEntry[];
  storedProcedures?: ObjectEntry[];
  views?: ObjectEntry[];
  functions?: ObjectEntry[];
}

export function parseSqlIndex(dbExportPath: string): ParseResult {
  const nodes: GraphNode[] = [];
  const warnings: string[] = [];

  const indexPath = join(dbExportPath, "_index.json");
  if (!existsSync(indexPath)) {
    warnings.push(`_index.json not found at: ${indexPath}`);
    return { nodes, edges: [], warnings };
  }

  let index: SqlIndex;
  try {
    index = JSON.parse(readFileSync(indexPath, "utf-8")) as SqlIndex;
  } catch (err) {
    warnings.push(`Failed to parse _index.json: ${String(err)}`);
    return { nodes, edges: [], warnings };
  }

  for (const table of index.tables ?? []) {
    nodes.push({
      id: makeTableId(table.schema, table.name),
      type: NodeType.SqlTable,
      name: table.name,
      metadata: {
        schema: table.schema,
        filePath: join(dbExportPath, table.file),
        columnCount: table.columnCount,
        columns: table.columns,
      },
    });
  }

  for (const sp of index.storedProcedures ?? []) {
    nodes.push({
      id: makeSpId(sp.schema, sp.name),
      type: NodeType.SqlProcedure,
      name: sp.name,
      metadata: {
        schema: sp.schema,
        filePath: join(dbExportPath, sp.file),
      },
    });
  }

  for (const view of index.views ?? []) {
    nodes.push({
      id: makeViewId(view.schema, view.name),
      type: NodeType.SqlView,
      name: view.name,
      metadata: {
        schema: view.schema,
        filePath: join(dbExportPath, view.file),
      },
    });
  }

  for (const func of index.functions ?? []) {
    nodes.push({
      id: makeFunctionId(func.schema, func.name),
      type: NodeType.SqlFunction,
      name: func.name,
      metadata: {
        schema: func.schema,
        filePath: join(dbExportPath, func.file),
      },
    });
  }

  return { nodes, edges: [], warnings };
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/parsers/sqlIndex.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parsers/sqlIndex.ts tests/parsers/sqlIndex.test.ts
git commit -m "feat: SQL index parser (pass 1)"
```

---

### Task 6: SQL Body Parser (Pass 2)

**Files:**
- Create: `src/parsers/sqlBody.ts`
- Create: `tests/parsers/sqlBody.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/parsers/sqlBody.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseSqlBody } from "../../src/parsers/sqlBody.js";
import { EdgeType } from "../../src/graph/model.js";

const transformSql = `
CREATE PROCEDURE [dbo].[p_Test_Transform]
(
    @BatchSize INT = 1000
)
AS
BEGIN
    INSERT INTO [dbo].[TestStaging] (Id, Name, StatusCode, copy_flag)
    SELECT Id, dbo.fnFormatName(Name), StatusCode, 1
    FROM [dbo].[ADFLog]
    WHERE ADFRunId IS NOT NULL;

    EXEC [dbo].[p_Batch_Process] @querykeys = '1,2,3', @key_col = 'Id',
        @dest_schema_name = 'dbo', @dest_object_name = 'TestStaging', @key_type = 'INT';
END
`;

const batchSql = `
CREATE PROCEDURE [dbo].[p_Batch_Process]
(
    @querykeys NVARCHAR(MAX),
    @dest_object_name NVARCHAR(200)
)
AS
BEGIN
    DECLARE @full_table_name NVARCHAR(MAX) = CONCAT(@dest_schema_name, N'.temp_', @dest_object_name);
    WHERE sc.OBJECT_ID = OBJECT_ID(@full_table_name, N'u');
    EXEC sp_executesql @sqlquery
END
`;

describe("parseSqlBody", () => {
  it("extracts EXEC calls as Calls edges", () => {
    const result = parseSqlBody("sp:dbo.p_Test_Transform", transformSql, "dbo");
    const calls = result.edges.filter((e) => e.type === EdgeType.Calls);
    expect(calls).toHaveLength(1);
    expect(calls[0].to).toBe("sp:dbo.p_Batch_Process");
  });

  it("extracts INSERT INTO as WritesTo edges", () => {
    const result = parseSqlBody("sp:dbo.p_Test_Transform", transformSql, "dbo");
    const writes = result.edges.filter((e) => e.type === EdgeType.WritesTo);
    expect(writes.some((e) => e.to === "table:dbo.TestStaging")).toBe(true);
  });

  it("extracts FROM as ReadsFrom edges", () => {
    const result = parseSqlBody("sp:dbo.p_Test_Transform", transformSql, "dbo");
    const reads = result.edges.filter((e) => e.type === EdgeType.ReadsFrom);
    expect(reads.some((e) => e.to === "table:dbo.ADFLog")).toBe(true);
  });

  it("extracts function calls as CallsFunction edges", () => {
    const result = parseSqlBody("sp:dbo.p_Test_Transform", transformSql, "dbo");
    const funcCalls = result.edges.filter((e) => e.type === EdgeType.CallsFunction);
    expect(funcCalls).toHaveLength(1);
    expect(funcCalls[0].to).toBe("func:dbo.fnFormatName");
  });

  it("flags OBJECT_ID with dynamic args as dynamic_reference", () => {
    const result = parseSqlBody("sp:dbo.p_Batch_Process", batchSql, "dbo");
    const refs = result.edges.filter((e) => e.type === EdgeType.References);
    expect(refs).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("dynamic"))).toBe(true);
  });

  it("extracts parameters from SP signature", () => {
    const result = parseSqlBody("sp:dbo.p_Test_Transform", transformSql, "dbo");
    expect(result.parameters).toHaveLength(1);
    expect(result.parameters![0].name).toBe("@BatchSize");
    expect(result.parameters![0].type).toBe("INT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/parsers/sqlBody.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement sqlBody.ts**

Create `src/parsers/sqlBody.ts`:

```typescript
import type { GraphEdge } from "../graph/model.js";
import { EdgeType } from "../graph/model.js";
import { makeSpId, makeTableId, makeFunctionId } from "../utils/nodeId.js";

export interface SpParameter {
  name: string;
  type: string;
  defaultValue?: string;
}

export interface SqlBodyResult {
  edges: GraphEdge[];
  warnings: string[];
  parameters?: SpParameter[];
  body: string;
}

const SYS_OBJECTS = new Set(["sys.columns", "sys.objects", "sys.types", "sys.schemas",
  "sys.procedures", "sys.tables", "sys.views", "sys.indexes", "sys.parameters",
  "INFORMATION_SCHEMA.COLUMNS", "INFORMATION_SCHEMA.TABLES"]);

function stripBrackets(name: string): string {
  return name.replace(/^\[|\]$/g, "");
}

function isSystemObject(schema: string, name: string): boolean {
  return SYS_OBJECTS.has(`${schema}.${name}`) || schema === "sys" || schema === "INFORMATION_SCHEMA";
}

export function parseSqlBody(spNodeId: string, sql: string, defaultSchema: string): SqlBodyResult {
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];
  const seenEdges = new Set<string>();

  function addEdge(to: string, type: EdgeType, meta: Record<string, unknown> = {}): void {
    const key = `${spNodeId}->${to}:${type}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ from: spNodeId, to, type, metadata: meta });
  }

  // Extract parameters
  const paramRegex = /(@\w+)\s+([\w() ,]+?)(?:\s*=\s*([^,\n)]+))?(?=[,\n)])/g;
  const paramSection = sql.match(/\(([\s\S]*?)\)\s*AS\b/i)?.[1] ?? "";
  const parameters: SpParameter[] = [];
  let paramMatch: RegExpExecArray | null;
  while ((paramMatch = paramRegex.exec(paramSection)) !== null) {
    parameters.push({
      name: paramMatch[1],
      type: paramMatch[2].trim(),
      defaultValue: paramMatch[3]?.trim(),
    });
  }

  // EXEC calls (not sp_executesql)
  const execRegex = /\bEXEC(?:UTE)?\s+(?:(\[?\w+\]?)\.)?(\[?\w+\]?)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = execRegex.exec(sql)) !== null) {
    const schema = match[1] ? stripBrackets(match[1]) : defaultSchema;
    const name = stripBrackets(match[2]);
    if (name === "sp_executesql") continue;
    if (isSystemObject(schema, name)) continue;
    addEdge(makeSpId(schema, name), EdgeType.Calls);
  }

  // INSERT INTO
  const insertRegex = /\bINSERT\s+INTO\s+(?:(\[?\w+\]?)\.)?(\[?\w+\]?)\b/gi;
  while ((match = insertRegex.exec(sql)) !== null) {
    const schema = match[1] ? stripBrackets(match[1]) : defaultSchema;
    const name = stripBrackets(match[2]);
    if (isSystemObject(schema, name)) continue;
    addEdge(makeTableId(schema, name), EdgeType.WritesTo);
  }

  // UPDATE
  const updateRegex = /\bUPDATE\s+(?:(\[?\w+\]?)\.)?(\[?\w+\]?)\b(?!\s*\()/gi;
  while ((match = updateRegex.exec(sql)) !== null) {
    const schema = match[1] ? stripBrackets(match[1]) : defaultSchema;
    const name = stripBrackets(match[2]);
    if (isSystemObject(schema, name)) continue;
    if (name.startsWith("@")) continue;
    addEdge(makeTableId(schema, name), EdgeType.WritesTo);
  }

  // DELETE FROM
  const deleteRegex = /\bDELETE\s+FROM\s+(?:(\[?\w+\]?)\.)?(\[?\w+\]?)\b/gi;
  while ((match = deleteRegex.exec(sql)) !== null) {
    const schema = match[1] ? stripBrackets(match[1]) : defaultSchema;
    const name = stripBrackets(match[2]);
    if (isSystemObject(schema, name)) continue;
    addEdge(makeTableId(schema, name), EdgeType.WritesTo);
  }

  // FROM / JOIN
  const fromRegex = /\b(?:FROM|JOIN)\s+(?:(\[?\w+\]?)\.)?(\[?\w+\]?)\b/gi;
  while ((match = fromRegex.exec(sql)) !== null) {
    const schema = match[1] ? stripBrackets(match[1]) : defaultSchema;
    const name = stripBrackets(match[2]);
    if (isSystemObject(schema, name)) continue;
    if (name.startsWith("@") || name.startsWith("#") || name === "STRING_SPLIT") continue;
    addEdge(makeTableId(schema, name), EdgeType.ReadsFrom);
  }

  // OBJECT_ID references
  const objectIdRegex = /OBJECT_ID\s*\(\s*(['"])(.*?)\1/gi;
  while ((match = objectIdRegex.exec(sql)) !== null) {
    const ref = match[2];
    if (ref.includes("@") || ref.includes("+")) {
      warnings.push(`Dynamic OBJECT_ID reference in ${spNodeId}: ${ref}`);
      continue;
    }
    const parts = ref.replace(/[\[\]]/g, "").split(".");
    const schema = parts.length > 1 ? parts[0] : defaultSchema;
    const name = parts.length > 1 ? parts[1] : parts[0];
    if (!isSystemObject(schema, name)) {
      addEdge(makeTableId(schema, name), EdgeType.References);
    }
  }

  // Function calls (dbo.fn_xxx pattern)
  const funcRegex = /\b(\w+)\.(fn\w+)\s*\(/gi;
  while ((match = funcRegex.exec(sql)) !== null) {
    const schema = match[1];
    const name = match[2];
    addEdge(makeFunctionId(schema, name), EdgeType.CallsFunction);
  }

  return { edges, warnings, parameters, body: sql };
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/parsers/sqlBody.test.ts
```

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/parsers/sqlBody.ts tests/parsers/sqlBody.test.ts
git commit -m "feat: SQL body parser (pass 2) — EXEC, INSERT/UPDATE/DELETE, FROM/JOIN, OBJECT_ID, function calls"
```

---

### Task 7: Table DDL Parser (Pass 3) + View Parser (Pass 4)

**Files:**
- Create: `src/parsers/tableDdl.ts`
- Create: `src/parsers/viewDef.ts`
- Create: `tests/parsers/tableDdl.test.ts`
- Create: `tests/parsers/viewDef.test.ts`

- [ ] **Step 1: Write the table DDL test**

Create `tests/parsers/tableDdl.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseTableDdl } from "../../src/parsers/tableDdl.js";
import { EdgeType } from "../../src/graph/model.js";

const ddl = `
CREATE TABLE [dbo].[TestStaging] (
    [Id] INT NOT NULL,
    [Name] NVARCHAR (200) NOT NULL,
    CONSTRAINT [PK_TestStaging] PRIMARY KEY CLUSTERED ([Id] ASC),
    CONSTRAINT [FK_TestStaging_ADFLog] FOREIGN KEY ([Id]) REFERENCES [dbo].[ADFLog] ([ADFLogId])
);
`;

describe("parseTableDdl", () => {
  it("extracts foreign key edges", () => {
    const result = parseTableDdl("table:dbo.TestStaging", ddl, "dbo");
    const fks = result.edges.filter((e) => e.type === EdgeType.ForeignKey);
    expect(fks).toHaveLength(1);
    expect(fks[0].to).toBe("table:dbo.ADFLog");
    expect(fks[0].metadata.constraint).toBe("FK_TestStaging_ADFLog");
  });

  it("returns no edges for tables without FKs", () => {
    const simpleDdl = `CREATE TABLE [dbo].[Simple] ([Id] INT NOT NULL);`;
    const result = parseTableDdl("table:dbo.Simple", simpleDdl, "dbo");
    expect(result.edges).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Write the view parser test**

Create `tests/parsers/viewDef.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseViewDef } from "../../src/parsers/viewDef.js";
import { EdgeType } from "../../src/graph/model.js";

const viewSql = `
CREATE VIEW [dbo].[vw_ActiveRecords]
AS
    SELECT ts.Id, ts.Name, ts.StatusCode
    FROM [dbo].[TestStaging] ts
    INNER JOIN [dbo].[ADFLog] al ON ts.Id = al.ADFLogId
    WHERE ts.copy_flag = 1;
`;

describe("parseViewDef", () => {
  it("extracts FROM/JOIN tables as ViewReads edges", () => {
    const result = parseViewDef("view:dbo.vw_ActiveRecords", viewSql, "dbo");
    const reads = result.edges.filter((e) => e.type === EdgeType.ViewReads);
    expect(reads).toHaveLength(2);
    const targets = reads.map((e) => e.to);
    expect(targets).toContain("table:dbo.TestStaging");
    expect(targets).toContain("table:dbo.ADFLog");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/parsers/tableDdl.test.ts tests/parsers/viewDef.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement tableDdl.ts**

Create `src/parsers/tableDdl.ts`:

```typescript
import type { GraphEdge } from "../graph/model.js";
import { EdgeType } from "../graph/model.js";
import { makeTableId } from "../utils/nodeId.js";

export interface TableDdlResult {
  edges: GraphEdge[];
  warnings: string[];
}

function stripBrackets(name: string): string {
  return name.replace(/^\[|\]$/g, "");
}

export function parseTableDdl(tableNodeId: string, ddl: string, defaultSchema: string): TableDdlResult {
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  const fkRegex = /CONSTRAINT\s+\[?(\w+)\]?\s+FOREIGN\s+KEY\s*\([^)]+\)\s*REFERENCES\s+(?:(\[?\w+\]?)\.)?(\[?\w+\]?)\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = fkRegex.exec(ddl)) !== null) {
    const constraint = match[1];
    const schema = match[2] ? stripBrackets(match[2]) : defaultSchema;
    const name = stripBrackets(match[3]);
    edges.push({
      from: tableNodeId,
      to: makeTableId(schema, name),
      type: EdgeType.ForeignKey,
      metadata: { constraint },
    });
  }

  return { edges, warnings };
}
```

- [ ] **Step 5: Implement viewDef.ts**

Create `src/parsers/viewDef.ts`:

```typescript
import type { GraphEdge } from "../graph/model.js";
import { EdgeType } from "../graph/model.js";
import { makeTableId } from "../utils/nodeId.js";

export interface ViewDefResult {
  edges: GraphEdge[];
  warnings: string[];
}

function stripBrackets(name: string): string {
  return name.replace(/^\[|\]$/g, "");
}

export function parseViewDef(viewNodeId: string, sql: string, defaultSchema: string): ViewDefResult {
  const edges: GraphEdge[] = [];
  const seenTargets = new Set<string>();

  const fromRegex = /\b(?:FROM|JOIN)\s+(?:(\[?\w+\]?)\.)?(\[?\w+\]?)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = fromRegex.exec(sql)) !== null) {
    const schema = match[1] ? stripBrackets(match[1]) : defaultSchema;
    const name = stripBrackets(match[2]);
    if (name.startsWith("@") || name.startsWith("#")) continue;
    if (schema === "sys" || schema === "INFORMATION_SCHEMA") continue;
    const targetId = makeTableId(schema, name);
    if (seenTargets.has(targetId)) continue;
    seenTargets.add(targetId);
    edges.push({ from: viewNodeId, to: targetId, type: EdgeType.ViewReads, metadata: {} });
  }

  return { edges, warnings: [] };
}
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/parsers/tableDdl.test.ts tests/parsers/viewDef.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/parsers/tableDdl.ts src/parsers/viewDef.ts tests/parsers/tableDdl.test.ts tests/parsers/viewDef.test.ts
git commit -m "feat: table DDL parser (pass 3) and view parser (pass 4)"
```

---

### Task 8: Dataverse Index Parser (Pass 5) + Entity Parser (Pass 6)

**Files:**
- Create: `src/parsers/dvIndex.ts`
- Create: `src/parsers/dvEntity.ts`
- Create: `tests/parsers/dvIndex.test.ts`
- Create: `tests/parsers/dvEntity.test.ts`

- [ ] **Step 1: Write the Dataverse index test**

Create `tests/parsers/dvIndex.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { join } from "path";
import { parseDvIndex } from "../../src/parsers/dvIndex.js";
import { NodeType } from "../../src/graph/model.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures/dataverse-schema/testenv");

describe("parseDvIndex", () => {
  it("creates entity nodes from index", () => {
    const result = parseDvIndex(fixtureRoot);
    const entities = result.nodes.filter((n) => n.type === NodeType.DvEntity);
    expect(entities).toHaveLength(2);
    expect(entities.map((e) => e.name)).toContain("alm_testentity");
    expect(entities.map((e) => e.name)).toContain("alm_relatedentity");
  });

  it("attaches display name and attribute count", () => {
    const result = parseDvIndex(fixtureRoot);
    const entity = result.nodes.find((n) => n.name === "alm_testentity")!;
    expect(entity.metadata.displayName).toBe("Test Entity");
    expect(entity.metadata.attributeCount).toBe(4);
  });

  it("stores attribute names from index", () => {
    const result = parseDvIndex(fixtureRoot);
    const entity = result.nodes.find((n) => n.name === "alm_testentity")!;
    const attrNames = entity.metadata.attributeNames as string[];
    expect(attrNames).toContain("alm_name");
    expect(attrNames).toContain("alm_statuscode");
  });

  it("returns warning for missing directory", () => {
    const result = parseDvIndex("/nonexistent/path");
    expect(result.nodes).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Write the Dataverse entity parser test**

Create `tests/parsers/dvEntity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { join } from "path";
import { parseDvEntity, clearEntityCache } from "../../src/parsers/dvEntity.js";
import { NodeType, EdgeType } from "../../src/graph/model.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures/dataverse-schema/testenv");

describe("parseDvEntity", () => {
  beforeEach(() => clearEntityCache());

  it("creates attribute nodes with metadata", () => {
    const result = parseDvEntity(fixtureRoot, "alm_testentity.json", "alm_testentity");
    const attrs = result.nodes.filter((n) => n.type === NodeType.DvAttribute);
    expect(attrs.length).toBeGreaterThanOrEqual(4);
    const nameAttr = attrs.find((a) => a.name === "alm_name")!;
    expect(nameAttr.metadata.attributeType).toBe("String");
    expect(nameAttr.metadata.requiredLevel).toBe("Recommended");
    expect(nameAttr.metadata.isValidForCreate).toBe(true);
  });

  it("creates HasAttribute edges", () => {
    const result = parseDvEntity(fixtureRoot, "alm_testentity.json", "alm_testentity");
    const hasAttr = result.edges.filter((e) => e.type === EdgeType.HasAttribute);
    expect(hasAttr.length).toBeGreaterThanOrEqual(4);
    expect(hasAttr[0].from).toBe("entity:alm_testentity");
  });

  it("creates LookupTo edges from lookup attributes", () => {
    const result = parseDvEntity(fixtureRoot, "alm_testentity.json", "alm_testentity");
    const lookups = result.edges.filter((e) => e.type === EdgeType.LookupTo);
    expect(lookups).toHaveLength(1);
    expect(lookups[0].from).toBe("entity:alm_testentity");
    expect(lookups[0].to).toBe("entity:alm_relatedentity");
  });

  it("extracts option set values for picklist attributes", () => {
    const result = parseDvEntity(fixtureRoot, "alm_testentity.json", "alm_testentity");
    const statusAttr = result.nodes.find((n) => n.name === "alm_statuscode")!;
    const optionSet = statusAttr.metadata.optionSet as Array<{ value: number; label: string }>;
    expect(optionSet).toHaveLength(3);
    expect(optionSet[0].value).toBe(1);
    expect(optionSet[0].label).toBe("Active");
  });

  it("returns null result for missing file", () => {
    const result = parseDvEntity(fixtureRoot, "nonexistent.json", "nonexistent");
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/parsers/dvIndex.test.ts tests/parsers/dvEntity.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement dvIndex.ts**

Create `src/parsers/dvIndex.ts`:

```typescript
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { GraphNode } from "../graph/model.js";
import { NodeType } from "../graph/model.js";
import type { ParseResult } from "./parseResult.js";
import { makeEntityId } from "../utils/nodeId.js";

interface IndexAttributeDetail {
  name: string;
  type: string;
}

interface IndexEntry {
  logicalName: string;
  displayName: string;
  entitySetName: string;
  primaryId: string;
  primaryName: string;
  attributeCount: number;
  file: string;
  attributes: string;
  attributeDetails?: IndexAttributeDetail[];
}

interface DvIndex {
  entities: IndexEntry[];
}

export function parseDvIndex(schemaPath: string): ParseResult {
  const nodes: GraphNode[] = [];
  const warnings: string[] = [];

  const indexPath = join(schemaPath, "_index.json");
  if (!existsSync(indexPath)) {
    warnings.push(`_index.json not found at: ${indexPath}`);
    return { nodes, edges: [], warnings };
  }

  let index: DvIndex;
  try {
    index = JSON.parse(readFileSync(indexPath, "utf-8")) as DvIndex;
  } catch (err) {
    warnings.push(`Failed to parse _index.json: ${String(err)}`);
    return { nodes, edges: [], warnings };
  }

  for (const entry of index.entities ?? []) {
    if (!entry.logicalName || !entry.file) {
      warnings.push(`Skipping index entry with missing logicalName or file`);
      continue;
    }

    const attrNames = (typeof entry.attributes === "string" ? entry.attributes : "")
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);

    nodes.push({
      id: makeEntityId(entry.logicalName),
      type: NodeType.DvEntity,
      name: entry.logicalName,
      metadata: {
        displayName: entry.displayName,
        entitySetName: entry.entitySetName,
        primaryId: entry.primaryId,
        primaryName: entry.primaryName,
        attributeCount: entry.attributeCount,
        schemaFile: entry.file,
        attributeNames: attrNames,
        attributeDetails: entry.attributeDetails,
      },
    });
  }

  return { nodes, edges: [], warnings };
}
```

- [ ] **Step 5: Implement dvEntity.ts**

Create `src/parsers/dvEntity.ts`:

```typescript
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { GraphNode, GraphEdge } from "../graph/model.js";
import { NodeType, EdgeType } from "../graph/model.js";
import type { ParseResult } from "./parseResult.js";
import { makeEntityId, makeAttributeId } from "../utils/nodeId.js";

export interface OptionSetValue {
  value: number;
  label: string;
}

export interface AttributeDetail {
  logicalName: string;
  attributeType: string;
  requiredLevel: string;
  isValidForCreate: boolean;
  isValidForRead: boolean;
  isValidForUpdate: boolean;
  displayName: string;
  isCustomAttribute: boolean;
  maxLength?: number;
  optionSet?: OptionSetValue[];
  lookupTargets?: string[];
}

const entityCache = new Map<string, ParseResult>();

export function clearEntityCache(): void {
  entityCache.clear();
}

export function parseDvEntity(
  schemaPath: string,
  schemaFile: string,
  entityLogicalName: string,
): ParseResult {
  const cacheKey = `${schemaPath}::${schemaFile}`;
  if (entityCache.has(cacheKey)) return entityCache.get(cacheKey)!;

  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];
  const result: ParseResult = { nodes, edges, warnings };

  const filePath = join(schemaPath, schemaFile);
  if (!existsSync(filePath)) {
    entityCache.set(cacheKey, result);
    return result;
  }

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    warnings.push(`Failed to parse entity file: ${schemaFile}`);
    entityCache.set(cacheKey, result);
    return result;
  }

  const entityId = makeEntityId(entityLogicalName);
  const rawAttributes = (raw.Attributes as unknown[]) ?? [];

  for (const a of rawAttributes) {
    const attr = a as Record<string, unknown>;
    const logicalName = (attr.LogicalName as string) ?? "";
    if (!logicalName) continue;

    const requiredLevelObj = attr.RequiredLevel as Record<string, unknown> | undefined;
    const displayNameObj = attr.DisplayName as Record<string, unknown> | undefined;
    const userLabel = displayNameObj?.UserLocalizedLabel as Record<string, unknown> | undefined;

    let optionSet: OptionSetValue[] | undefined;
    const optionSetObj = attr.OptionSet as Record<string, unknown> | undefined;
    if (optionSetObj) {
      const options = (optionSetObj.Options as unknown[]) ?? [];
      optionSet = options.map((o) => {
        const opt = o as Record<string, unknown>;
        const labelObj = opt.Label as Record<string, unknown> | undefined;
        const optUserLabel = labelObj?.UserLocalizedLabel as Record<string, unknown> | undefined;
        return {
          value: (opt.Value as number) ?? 0,
          label: (optUserLabel?.Label as string) ?? "",
        };
      });
    }

    const targets = attr.Targets as string[] | undefined;
    const attrId = makeAttributeId(entityLogicalName, logicalName);

    nodes.push({
      id: attrId,
      type: NodeType.DvAttribute,
      name: logicalName,
      metadata: {
        entityLogicalName,
        attributeType: (attr.AttributeType as string) ?? "",
        requiredLevel: (requiredLevelObj?.Value as string) ?? "",
        isValidForCreate: (attr.IsValidForCreate as boolean) ?? false,
        isValidForRead: (attr.IsValidForRead as boolean) ?? false,
        isValidForUpdate: (attr.IsValidForUpdate as boolean) ?? false,
        displayName: (userLabel?.Label as string) ?? "",
        isCustomAttribute: (attr.IsCustomAttribute as boolean) ?? false,
        maxLength: attr.MaxLength as number | undefined,
        optionSet,
        lookupTargets: targets,
      },
    });

    edges.push({
      from: entityId,
      to: attrId,
      type: EdgeType.HasAttribute,
      metadata: {},
    });

    if (targets && targets.length > 0) {
      for (const target of targets) {
        edges.push({
          from: entityId,
          to: makeEntityId(target),
          type: EdgeType.LookupTo,
          metadata: { viaAttribute: logicalName },
        });
      }
    }
  }

  entityCache.set(cacheKey, result);
  return result;
}
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/parsers/dvIndex.test.ts tests/parsers/dvEntity.test.ts
```

Expected: All 9 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/parsers/dvIndex.ts src/parsers/dvEntity.ts tests/parsers/dvIndex.test.ts tests/parsers/dvEntity.test.ts
git commit -m "feat: Dataverse index parser (pass 5) and entity parser (pass 6)"
```

---

### Task 9: Config Loader + Constants + Staleness

**Files:**
- Create: `src/config.ts`
- Create: `src/constants.ts`
- Create: `src/graph/staleness.ts`
- Create: `tests/config.test.ts`

- [ ] **Step 1: Write config test**

Create `tests/config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { validateConfig } from "../../src/config.js";

describe("validateConfig", () => {
  it("validates a valid config", () => {
    const raw = {
      environments: {
        devqa: {
          dbExportPath: "/path/to/db-export/devqa",
          schemaPath: "/path/to/dataverse-schema/devqa",
          default: true,
        },
      },
    };
    const config = validateConfig(raw, "test");
    expect(config.environments.devqa.dbExportPath).toBe("/path/to/db-export/devqa");
    expect(config.environments.devqa.default).toBe(true);
  });

  it("rejects config without environments", () => {
    expect(() => validateConfig({}, "test")).toThrow("environments");
  });

  it("rejects environment without dbExportPath or schemaPath", () => {
    const raw = { environments: { bad: {} } };
    expect(() => validateConfig(raw, "test")).toThrow();
  });

  it("accepts environment with only dbExportPath", () => {
    const raw = { environments: { sqlonly: { dbExportPath: "/path" } } };
    const config = validateConfig(raw, "test");
    expect(config.environments.sqlonly.dbExportPath).toBe("/path");
    expect(config.environments.sqlonly.schemaPath).toBeUndefined();
  });

  it("accepts environment with only schemaPath", () => {
    const raw = { environments: { dvonly: { schemaPath: "/path" } } };
    const config = validateConfig(raw, "test");
    expect(config.environments.dvonly.schemaPath).toBe("/path");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/config.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement constants.ts**

Create `src/constants.ts`:

```typescript
export const SQL_DIRS = ["procedure", "table", "view", "function"];
```

- [ ] **Step 4: Implement config.ts**

Create `src/config.ts`:

```typescript
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

export interface EnvironmentConfig {
  dbExportPath?: string;
  schemaPath?: string;
  default?: boolean;
}

export interface BoomerangGraphConfig {
  environments: Record<string, EnvironmentConfig>;
}

export function loadConfig(): BoomerangGraphConfig {
  const configPath = process.env.BOOMERANG_CONFIG;
  if (configPath) return readConfigFile(configPath);

  let serverDir: string;
  try {
    serverDir = dirname(fileURLToPath(import.meta.url));
  } catch {
    serverDir = process.cwd();
  }
  const sidecarPath = join(serverDir, "..", "boomerang-graph.json");
  if (existsSync(sidecarPath)) return readConfigFile(sidecarPath);

  throw new Error(
    "boomerang-graph: no configuration found. " +
      "Set BOOMERANG_CONFIG to a config file path, or place boomerang-graph.json next to the server.",
  );
}

function readConfigFile(filePath: string): BoomerangGraphConfig {
  if (!existsSync(filePath)) {
    throw new Error(`boomerang-graph: config file not found: ${filePath}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    throw new Error(`boomerang-graph: failed to parse config file '${filePath}': ${String(err)}`);
  }
  return validateConfig(raw, filePath);
}

export function validateConfig(raw: unknown, source: string): BoomerangGraphConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`boomerang-graph: config '${source}' must be a JSON object`);
  }
  const obj = raw as Record<string, unknown>;
  if (!obj.environments || typeof obj.environments !== "object" || Array.isArray(obj.environments)) {
    throw new Error(`boomerang-graph: config '${source}' must have an "environments" object`);
  }
  const envs = obj.environments as Record<string, unknown>;
  const environments: Record<string, EnvironmentConfig> = {};

  for (const [name, envRaw] of Object.entries(envs)) {
    if (!envRaw || typeof envRaw !== "object" || Array.isArray(envRaw)) {
      throw new Error(`boomerang-graph: environment '${name}' must be an object`);
    }
    const env = envRaw as Record<string, unknown>;
    if (!env.dbExportPath && !env.schemaPath) {
      throw new Error(
        `boomerang-graph: environment '${name}' must have at least one of "dbExportPath" or "schemaPath"`,
      );
    }
    environments[name] = {
      dbExportPath: env.dbExportPath as string | undefined,
      schemaPath: env.schemaPath as string | undefined,
      default: env.default as boolean | undefined,
    };
  }

  return { environments };
}
```

- [ ] **Step 5: Implement staleness.ts**

Create `src/graph/staleness.ts`:

```typescript
import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { SQL_DIRS } from "../constants.js";

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
  private paths: string[];
  private builtAt: number | null = null;
  private builtMaxMtime: number | null = null;

  constructor(paths: string[]) {
    this.paths = [...paths];
  }

  isStale(): boolean {
    if (this.builtAt === null || this.builtMaxMtime === null) return true;
    if (this.paths.length === 0) return true;
    if (!this.paths.some((p) => existsSync(p))) return true;
    return this.currentMaxMtime() > this.builtMaxMtime;
  }

  markBuilt(): void {
    this.builtMaxMtime = this.currentMaxMtime();
    this.builtAt = Date.now();
  }

  lastBuildTime(): Date | null {
    return this.builtAt === null ? null : new Date(this.builtAt);
  }

  invalidate(): void {
    this.builtAt = null;
    this.builtMaxMtime = null;
  }

  private currentMaxMtime(): number {
    let max = 0;
    for (const rootPath of this.paths) {
      const dirMax = maxMtimeMs(rootPath);
      if (dirMax > max) max = dirMax;
    }
    return max;
  }
}
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/config.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add src/config.ts src/constants.ts src/graph/staleness.ts tests/config.test.ts
git commit -m "feat: config loader, constants, staleness tracker"
```

---

### Task 10: Graph Manager

**Files:**
- Create: `src/graph/manager.ts`
- Create: `tests/graph/manager.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/graph/manager.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import type { BoomerangGraphConfig } from "../../src/config.js";
import { NodeType } from "../../src/graph/model.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");

const testConfig: BoomerangGraphConfig = {
  environments: {
    testenv: {
      dbExportPath: join(fixtureRoot, "db-export/testenv"),
      schemaPath: join(fixtureRoot, "dataverse-schema/testenv"),
      default: true,
    },
  },
};

describe("GraphManager", () => {
  it("builds graph lazily on first ensureGraph call", () => {
    const manager = new GraphManager(testConfig);
    const build = manager.ensureGraph("testenv");
    expect(build.graph.stats().nodeCount).toBeGreaterThan(0);
    expect(build.buildTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("uses default environment when none specified", () => {
    const manager = new GraphManager(testConfig);
    const build = manager.ensureGraph();
    expect(build.graph.stats().nodeCount).toBeGreaterThan(0);
  });

  it("creates SQL nodes from index", () => {
    const manager = new GraphManager(testConfig);
    const { graph } = manager.ensureGraph("testenv");
    const tables = graph.getNodesByType(NodeType.SqlTable);
    expect(tables).toHaveLength(2);
    const sps = graph.getNodesByType(NodeType.SqlProcedure);
    expect(sps).toHaveLength(2);
  });

  it("creates Dataverse entity nodes from index", () => {
    const manager = new GraphManager(testConfig);
    const { graph } = manager.ensureGraph("testenv");
    const entities = graph.getNodesByType(NodeType.DvEntity);
    expect(entities).toHaveLength(2);
  });

  it("lists environments with stats", () => {
    const manager = new GraphManager(testConfig);
    manager.ensureGraph("testenv");
    const envs = manager.listEnvironments();
    expect(envs).toHaveLength(1);
    expect(envs[0].name).toBe("testenv");
    expect(envs[0].isDefault).toBe(true);
    expect(envs[0].nodeCount).toBeGreaterThan(0);
  });

  it("returns cached graph on second call", () => {
    const manager = new GraphManager(testConfig);
    const build1 = manager.ensureGraph("testenv");
    const build2 = manager.ensureGraph("testenv");
    expect(build2.graph).toBe(build1.graph);
  });

  it("runs lazy deep passes on demand", () => {
    const manager = new GraphManager(testConfig);
    const { graph } = manager.ensureDeepSql("testenv");
    const edges = graph.allEdges();
    expect(edges.length).toBeGreaterThan(0);
  });

  it("runs lazy Dataverse deep pass on demand", () => {
    const manager = new GraphManager(testConfig);
    const { graph } = manager.ensureDeepDv("testenv");
    const attrs = graph.getNodesByType(NodeType.DvAttribute);
    expect(attrs.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/graph/manager.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement manager.ts**

Create `src/graph/manager.ts`:

```typescript
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { Graph } from "./model.js";
import { StalenessChecker } from "./staleness.js";
import type { BoomerangGraphConfig } from "../config.js";
import { parseSqlIndex } from "../parsers/sqlIndex.js";
import { parseDvIndex } from "../parsers/dvIndex.js";
import { parseSqlBody } from "../parsers/sqlBody.js";
import { parseTableDdl } from "../parsers/tableDdl.js";
import { parseViewDef } from "../parsers/viewDef.js";
import { parseDvEntity, clearEntityCache } from "../parsers/dvEntity.js";
import { NodeType } from "./model.js";

export interface EnvironmentInfo {
  name: string;
  isDefault: boolean;
  nodeCount: number | null;
  edgeCount: number | null;
  lastBuild: Date | null;
  isStale: boolean;
  source: "config" | "runtime";
  dbExportPath?: string;
  schemaPath?: string;
}

interface EnvState {
  graph: Graph;
  warnings: string[];
  buildTimeMs: number;
  staleness: StalenessChecker;
  deepSqlDone: boolean;
  deepDvDone: boolean;
}

export class GraphManager {
  private graphs: Map<string, EnvState> = new Map();
  private config: BoomerangGraphConfig;
  private defaultEnv: string;

  constructor(config: BoomerangGraphConfig) {
    this.config = config;
    const defaultEntry = Object.entries(config.environments).find(([, e]) => e.default);
    this.defaultEnv = defaultEntry?.[0] ?? Object.keys(config.environments)[0];
  }

  getDefaultEnvironment(): string {
    return this.defaultEnv;
  }

  ensureGraph(environment?: string): { graph: Graph; warnings: string[]; buildTimeMs: number } {
    const envName = environment ?? this.defaultEnv;
    const existing = this.graphs.get(envName);
    if (existing && !existing.staleness.isStale()) {
      return { graph: existing.graph, warnings: existing.warnings, buildTimeMs: existing.buildTimeMs };
    }

    const envConfig = this.config.environments[envName];
    if (!envConfig) {
      throw new Error(`boomerang-graph: unknown environment '${envName}'`);
    }

    const start = Date.now();
    const graph = new Graph();
    const warnings: string[] = [];

    const watchPaths: string[] = [];
    if (envConfig.dbExportPath) watchPaths.push(envConfig.dbExportPath);
    if (envConfig.schemaPath) watchPaths.push(envConfig.schemaPath);
    const staleness = new StalenessChecker(watchPaths);

    if (envConfig.dbExportPath) {
      const sqlResult = parseSqlIndex(envConfig.dbExportPath);
      for (const node of sqlResult.nodes) graph.addNode(node);
      for (const edge of sqlResult.edges) graph.addEdge(edge);
      warnings.push(...sqlResult.warnings);
    }

    if (envConfig.schemaPath) {
      const dvResult = parseDvIndex(envConfig.schemaPath);
      for (const node of dvResult.nodes) graph.addNode(node);
      for (const edge of dvResult.edges) graph.addEdge(edge);
      warnings.push(...dvResult.warnings);
    }

    staleness.markBuilt();
    const buildTimeMs = Date.now() - start;

    const state: EnvState = { graph, warnings, buildTimeMs, staleness, deepSqlDone: false, deepDvDone: false };
    this.graphs.set(envName, state);

    return { graph, warnings, buildTimeMs };
  }

  ensureDeepSql(environment?: string): { graph: Graph; warnings: string[] } {
    const envName = environment ?? this.defaultEnv;
    const build = this.ensureGraph(envName);
    const state = this.graphs.get(envName)!;

    if (state.deepSqlDone) return { graph: build.graph, warnings: build.warnings };

    const envConfig = this.config.environments[envName]!;
    if (!envConfig.dbExportPath) return { graph: build.graph, warnings: build.warnings };

    const sps = build.graph.getNodesByType(NodeType.SqlProcedure);
    for (const sp of sps) {
      const filePath = sp.metadata.filePath as string;
      if (!filePath || !existsSync(filePath)) continue;
      const sql = readFileSync(filePath, "utf-8");
      const schema = (sp.metadata.schema as string) ?? "dbo";
      const bodyResult = parseSqlBody(sp.id, sql, schema);
      for (const edge of bodyResult.edges) build.graph.addEdge(edge);
      if (bodyResult.parameters) sp.metadata.parameters = bodyResult.parameters;
      sp.metadata.body = bodyResult.body;
      build.warnings.push(...bodyResult.warnings);
    }

    const tables = build.graph.getNodesByType(NodeType.SqlTable);
    for (const table of tables) {
      const filePath = table.metadata.filePath as string;
      if (!filePath || !existsSync(filePath)) continue;
      const ddl = readFileSync(filePath, "utf-8");
      const schema = (table.metadata.schema as string) ?? "dbo";
      const ddlResult = parseTableDdl(table.id, ddl, schema);
      for (const edge of ddlResult.edges) build.graph.addEdge(edge);
      build.warnings.push(...ddlResult.warnings);
    }

    const views = build.graph.getNodesByType(NodeType.SqlView);
    for (const view of views) {
      const filePath = view.metadata.filePath as string;
      if (!filePath || !existsSync(filePath)) continue;
      const sql = readFileSync(filePath, "utf-8");
      const schema = (view.metadata.schema as string) ?? "dbo";
      const viewResult = parseViewDef(view.id, sql, schema);
      for (const edge of viewResult.edges) build.graph.addEdge(edge);
      build.warnings.push(...viewResult.warnings);
    }

    state.deepSqlDone = true;
    return { graph: build.graph, warnings: build.warnings };
  }

  ensureDeepDv(environment?: string): { graph: Graph; warnings: string[] } {
    const envName = environment ?? this.defaultEnv;
    const build = this.ensureGraph(envName);
    const state = this.graphs.get(envName)!;

    if (state.deepDvDone) return { graph: build.graph, warnings: build.warnings };

    const envConfig = this.config.environments[envName]!;
    if (!envConfig.schemaPath) return { graph: build.graph, warnings: build.warnings };

    clearEntityCache();
    const entities = build.graph.getNodesByType(NodeType.DvEntity);
    for (const entity of entities) {
      const schemaFile = entity.metadata.schemaFile as string;
      if (!schemaFile) continue;
      const entityResult = parseDvEntity(envConfig.schemaPath, schemaFile, entity.name);
      for (const node of entityResult.nodes) build.graph.addNode(node);
      for (const edge of entityResult.edges) build.graph.addEdge(edge);
      build.warnings.push(...entityResult.warnings);
    }

    state.deepDvDone = true;
    return { graph: build.graph, warnings: build.warnings };
  }

  listEnvironments(): EnvironmentInfo[] {
    const result: EnvironmentInfo[] = [];
    for (const [name, envConfig] of Object.entries(this.config.environments)) {
      const state = this.graphs.get(name);
      result.push({
        name,
        isDefault: name === this.defaultEnv,
        nodeCount: state ? state.graph.stats().nodeCount : null,
        edgeCount: state ? state.graph.stats().edgeCount : null,
        lastBuild: state?.staleness.lastBuildTime() ?? null,
        isStale: state?.staleness.isStale() ?? true,
        source: "config",
        dbExportPath: envConfig.dbExportPath,
        schemaPath: envConfig.schemaPath,
      });
    }
    return result;
  }

  getEnvironmentConfig(envName: string): { dbExportPath?: string; schemaPath?: string } {
    const env = this.config.environments[envName];
    if (!env) throw new Error(`boomerang-graph: unknown environment '${envName}'`);
    return { dbExportPath: env.dbExportPath, schemaPath: env.schemaPath };
  }
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/graph/manager.test.ts
```

Expected: All 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/graph/manager.ts tests/graph/manager.test.ts
git commit -m "feat: multi-environment graph manager with lazy deep passes"
```

---

### Task 11: Cross-Reference Utilities

**Files:**
- Create: `src/utils/crossRef.ts`
- Create: `tests/utils/crossRef.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/utils/crossRef.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildAdfContext, buildSeeAlso } from "../../src/utils/crossRef.js";

describe("crossRef", () => {
  it("builds adf_context for a stored procedure", () => {
    const ctx = buildAdfContext("sp", "dbo.p_Test_Transform", "devqa");
    expect(ctx.see_also).toHaveLength(1);
    expect(ctx.see_also[0].server).toBe("adf-graph");
    expect(ctx.see_also[0].tool).toBe("graph_describe_stored_procedure");
    expect(ctx.see_also[0].args.name).toBe("p_Test_Transform");
  });

  it("builds adf_context for an entity", () => {
    const ctx = buildAdfContext("entity", "alm_testentity", "devqa");
    expect(ctx.see_also).toHaveLength(2);
    const tools = ctx.see_also.map((s) => s.tool);
    expect(tools).toContain("graph_describe_entity");
    expect(tools).toContain("graph_entity_coverage");
  });

  it("builds adf_context for a table", () => {
    const ctx = buildAdfContext("table", "dbo.TestStaging", "devqa");
    expect(ctx.see_also[0].tool).toBe("graph_describe_table");
  });

  it("builds see_also for bg_enrich", () => {
    const sa = buildSeeAlso(["dbo.p_Test", "alm_entity"], "devqa");
    expect(sa.server).toBe("boomerang-graph");
    expect(sa.tool).toBe("bg_enrich");
    expect(sa.args.names).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/utils/crossRef.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement crossRef.ts**

Create `src/utils/crossRef.ts`:

```typescript
export interface SeeAlsoEntry {
  server: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
}

export interface AdfContext {
  see_also: SeeAlsoEntry[];
}

export function buildAdfContext(
  objectType: "sp" | "table" | "view" | "func" | "entity",
  qualifiedName: string,
  environment: string,
): AdfContext {
  const see_also: SeeAlsoEntry[] = [];

  switch (objectType) {
    case "sp": {
      const spName = qualifiedName.includes(".") ? qualifiedName.split(".").slice(1).join(".") : qualifiedName;
      see_also.push({
        server: "adf-graph",
        tool: "graph_describe_stored_procedure",
        args: { name: spName, environment },
        reason: "Pipeline relationships for this SP",
      });
      break;
    }
    case "table": {
      const tableName = qualifiedName.includes(".") ? qualifiedName.split(".").slice(1).join(".") : qualifiedName;
      see_also.push({
        server: "adf-graph",
        tool: "graph_describe_table",
        args: { name: tableName, environment },
        reason: "Pipeline consumers for this table",
      });
      break;
    }
    case "entity":
      see_also.push({
        server: "adf-graph",
        tool: "graph_describe_entity",
        args: { entity: qualifiedName, environment },
        reason: "Entity metadata and pipeline consumers",
      });
      see_also.push({
        server: "adf-graph",
        tool: "graph_entity_coverage",
        args: { entity: qualifiedName, environment },
        reason: "All pipelines writing to this entity",
      });
      break;
    case "view":
    case "func":
      break;
  }

  return { see_also };
}

export function buildSeeAlso(names: string[], environment: string): SeeAlsoEntry {
  return {
    server: "boomerang-graph",
    tool: "bg_enrich",
    args: { names, environment },
    reason: "Deep SQL/Dataverse detail for referenced objects",
  };
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/utils/crossRef.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/crossRef.ts tests/utils/crossRef.test.ts
git commit -m "feat: cross-reference utilities for adf-graph interop"
```

---

### Task 12: Core Tools — stats, list_environments, sp_body, describe_sql_object, describe_entity

**Files:**
- Create: `src/tools/stats.ts`
- Create: `src/tools/listEnvironments.ts`
- Create: `src/tools/spBody.ts`
- Create: `src/tools/describeSqlObject.ts`
- Create: `src/tools/describeEntity.ts`
- Create: `tests/tools/describeSqlObject.test.ts`
- Create: `tests/tools/describeEntity.test.ts`

- [ ] **Step 1: Write describe SQL object test**

Create `tests/tools/describeSqlObject.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import { handleDescribeSqlObject } from "../../src/tools/describeSqlObject.js";
import type { BoomerangGraphConfig } from "../../src/config.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const config: BoomerangGraphConfig = {
  environments: {
    testenv: {
      dbExportPath: join(fixtureRoot, "db-export/testenv"),
      schemaPath: join(fixtureRoot, "dataverse-schema/testenv"),
      default: true,
    },
  },
};

describe("handleDescribeSqlObject", () => {
  it("returns summary for a table", () => {
    const manager = new GraphManager(config);
    const result = handleDescribeSqlObject(manager, "TestStaging", "testenv", "summary");
    expect(result.name).toBe("TestStaging");
    expect(result.objectType).toBe("sql_table");
    expect(result.columns).toHaveLength(4);
    expect(result.adf_context).toBeDefined();
  });

  it("returns summary for a stored procedure", () => {
    const manager = new GraphManager(config);
    const result = handleDescribeSqlObject(manager, "p_Test_Transform", "testenv", "summary");
    expect(result.name).toBe("p_Test_Transform");
    expect(result.objectType).toBe("sql_procedure");
  });

  it("returns full detail with edges for SP", () => {
    const manager = new GraphManager(config);
    const result = handleDescribeSqlObject(manager, "p_Test_Transform", "testenv", "full");
    expect(result.body).toBeDefined();
    expect(result.dependencies).toBeDefined();
    expect(result.dependencies!.writesTo!.length).toBeGreaterThan(0);
    expect(result.dependencies!.calls!.length).toBeGreaterThan(0);
  });

  it("returns error for unknown object", () => {
    const manager = new GraphManager(config);
    const result = handleDescribeSqlObject(manager, "NonExistent", "testenv", "summary");
    expect(result.error).toBeDefined();
  });
});
```

- [ ] **Step 2: Write describe entity test**

Create `tests/tools/describeEntity.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import { handleDescribeEntity } from "../../src/tools/describeEntity.js";
import type { BoomerangGraphConfig } from "../../src/config.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const config: BoomerangGraphConfig = {
  environments: {
    testenv: {
      dbExportPath: join(fixtureRoot, "db-export/testenv"),
      schemaPath: join(fixtureRoot, "dataverse-schema/testenv"),
      default: true,
    },
  },
};

describe("handleDescribeEntity", () => {
  it("returns summary for an entity", () => {
    const manager = new GraphManager(config);
    const result = handleDescribeEntity(manager, "alm_testentity", "testenv", "summary");
    expect(result.entity).toBe("alm_testentity");
    expect(result.displayName).toBe("Test Entity");
    expect(result.attributeCount).toBe(4);
    expect(result.adf_context).toBeDefined();
  });

  it("returns attributes at attributes depth", () => {
    const manager = new GraphManager(config);
    const result = handleDescribeEntity(manager, "alm_testentity", "testenv", "attributes");
    expect(result.attributes).toBeDefined();
    expect(result.attributes!.length).toBeGreaterThan(0);
    const nameAttr = result.attributes!.find((a) => a.logicalName === "alm_name");
    expect(nameAttr).toBeDefined();
    expect(nameAttr!.attributeType).toBe("String");
  });

  it("returns option set values at full depth", () => {
    const manager = new GraphManager(config);
    const result = handleDescribeEntity(manager, "alm_testentity", "testenv", "full");
    const statusAttr = result.attributes!.find((a) => a.logicalName === "alm_statuscode");
    expect(statusAttr!.optionSet).toBeDefined();
    expect(statusAttr!.optionSet).toHaveLength(3);
  });

  it("returns error for unknown entity", () => {
    const manager = new GraphManager(config);
    const result = handleDescribeEntity(manager, "nonexistent", "testenv", "summary");
    expect(result.error).toBeDefined();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/tools/describeSqlObject.test.ts tests/tools/describeEntity.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement stats.ts**

Create `src/tools/stats.ts`:

```typescript
import type { GraphManager } from "../graph/manager.js";

export function handleStats(manager: GraphManager, environment?: string) {
  const build = manager.ensureGraph(environment);
  const stats = build.graph.stats();
  const envName = environment ?? manager.getDefaultEnvironment();
  const envInfo = manager.listEnvironments().find((e) => e.name === envName);
  return {
    environment: envName,
    ...stats,
    buildTimeMs: build.buildTimeMs,
    lastBuild: envInfo?.lastBuild?.toISOString() ?? null,
    isStale: envInfo?.isStale ?? true,
    warnings: build.warnings,
  };
}
```

- [ ] **Step 5: Implement listEnvironments.ts**

Create `src/tools/listEnvironments.ts`:

```typescript
import type { GraphManager } from "../graph/manager.js";

export function handleListEnvironments(manager: GraphManager) {
  return { environments: manager.listEnvironments() };
}
```

- [ ] **Step 6: Implement spBody.ts**

Create `src/tools/spBody.ts`:

```typescript
import { readFileSync, existsSync } from "fs";
import type { GraphManager } from "../graph/manager.js";
import { NodeType } from "../graph/model.js";
import { buildAdfContext } from "../utils/crossRef.js";

export function handleSpBody(manager: GraphManager, name: string, environment?: string) {
  const envName = environment ?? manager.getDefaultEnvironment();
  const { graph } = manager.ensureGraph(envName);

  const nodes = graph.getNodesByType(NodeType.SqlProcedure)
    .concat(graph.getNodesByType(NodeType.SqlFunction));
  const node = nodes.find((n) => n.name.toLowerCase() === name.toLowerCase());

  if (!node) {
    return { error: `SQL object '${name}' not found in environment '${envName}'` };
  }

  const filePath = node.metadata.filePath as string;
  if (!filePath || !existsSync(filePath)) {
    return { error: `File not found for '${name}': ${filePath}` };
  }

  const body = readFileSync(filePath, "utf-8");
  const schema = (node.metadata.schema as string) ?? "dbo";
  return {
    name: node.name,
    schema,
    objectType: node.type,
    body,
    adf_context: buildAdfContext("sp", `${schema}.${node.name}`, envName),
  };
}
```

- [ ] **Step 7: Implement describeSqlObject.ts**

Create `src/tools/describeSqlObject.ts`:

```typescript
import type { GraphManager } from "../graph/manager.js";
import { NodeType, EdgeType } from "../graph/model.js";
import { buildAdfContext } from "../utils/crossRef.js";
import { parseNodeId } from "../utils/nodeId.js";

type DetailLevel = "summary" | "full";

export function handleDescribeSqlObject(
  manager: GraphManager,
  name: string,
  environment: string | undefined,
  detail: DetailLevel,
) {
  const envName = environment ?? manager.getDefaultEnvironment();
  const { graph } = manager.ensureGraph(envName);

  const allSqlTypes = [NodeType.SqlTable, NodeType.SqlProcedure, NodeType.SqlView, NodeType.SqlFunction];
  let node = null;
  for (const t of allSqlTypes) {
    node = graph.getNodesByType(t).find((n) => n.name.toLowerCase() === name.toLowerCase());
    if (node) break;
  }

  if (!node) {
    return { error: `SQL object '${name}' not found in environment '${envName}'` };
  }

  const schema = (node.metadata.schema as string) ?? "dbo";
  const objectTypeStr = node.type === NodeType.SqlProcedure ? "sp"
    : node.type === NodeType.SqlTable ? "table"
    : node.type === NodeType.SqlView ? "view" : "func";

  const result: Record<string, unknown> = {
    name: node.name,
    schema,
    objectType: node.type,
    environment: envName,
    adf_context: buildAdfContext(objectTypeStr as "sp" | "table" | "view" | "func", `${schema}.${node.name}`, envName),
  };

  if (node.type === NodeType.SqlTable) {
    result.columns = node.metadata.columns;
    result.columnCount = node.metadata.columnCount;
  }

  if (detail === "full") {
    if (node.type === NodeType.SqlProcedure || node.type === NodeType.SqlFunction) {
      manager.ensureDeepSql(envName);
      result.body = node.metadata.body;
      result.parameters = node.metadata.parameters;
    }
    if (node.type === NodeType.SqlTable) {
      manager.ensureDeepSql(envName);
    }

    const outgoing = graph.getOutgoing(node.id);
    const incoming = graph.getIncoming(node.id);

    const deps: Record<string, string[]> = {};
    const edgeGroups = new Map<EdgeType, string[]>();
    for (const edge of outgoing) {
      const { qualifiedName } = parseNodeId(edge.to);
      if (!edgeGroups.has(edge.type)) edgeGroups.set(edge.type, []);
      edgeGroups.get(edge.type)!.push(qualifiedName);
    }
    for (const [type, names] of edgeGroups) deps[type] = names;

    const consumers: Record<string, string[]> = {};
    const inEdgeGroups = new Map<EdgeType, string[]>();
    for (const edge of incoming) {
      const { qualifiedName } = parseNodeId(edge.from);
      if (!inEdgeGroups.has(edge.type)) inEdgeGroups.set(edge.type, []);
      inEdgeGroups.get(edge.type)!.push(qualifiedName);
    }
    for (const [type, names] of inEdgeGroups) consumers[type] = names;

    result.dependencies = deps;
    result.consumers = consumers;
  }

  return result;
}
```

- [ ] **Step 8: Implement describeEntity.ts**

Create `src/tools/describeEntity.ts`:

```typescript
import type { GraphManager } from "../graph/manager.js";
import { NodeType, EdgeType } from "../graph/model.js";
import { buildAdfContext } from "../utils/crossRef.js";

type DetailLevel = "summary" | "attributes" | "full";

export function handleDescribeEntity(
  manager: GraphManager,
  entity: string,
  environment: string | undefined,
  detail: DetailLevel,
) {
  const envName = environment ?? manager.getDefaultEnvironment();
  const { graph } = manager.ensureGraph(envName);

  const node = graph.getNodesByType(NodeType.DvEntity)
    .find((n) => n.name.toLowerCase() === entity.toLowerCase());

  if (!node) {
    return { error: `Entity '${entity}' not found in environment '${envName}'` };
  }

  const result: Record<string, unknown> = {
    entity: node.name,
    displayName: node.metadata.displayName,
    entitySetName: node.metadata.entitySetName,
    primaryId: node.metadata.primaryId,
    primaryName: node.metadata.primaryName,
    attributeCount: node.metadata.attributeCount,
    environment: envName,
    adf_context: buildAdfContext("entity", node.name, envName),
  };

  if (detail === "summary") return result;

  manager.ensureDeepDv(envName);

  const outgoing = graph.getOutgoing(node.id);
  const attrEdges = outgoing.filter((e) => e.type === EdgeType.HasAttribute);

  const attributes = attrEdges.map((edge) => {
    const attrNode = graph.getNode(edge.to);
    if (!attrNode) return null;
    const attr: Record<string, unknown> = {
      logicalName: attrNode.name,
      attributeType: attrNode.metadata.attributeType,
      requiredLevel: attrNode.metadata.requiredLevel,
      displayName: attrNode.metadata.displayName,
      isValidForCreate: attrNode.metadata.isValidForCreate,
      isValidForRead: attrNode.metadata.isValidForRead,
      isValidForUpdate: attrNode.metadata.isValidForUpdate,
      isCustomAttribute: attrNode.metadata.isCustomAttribute,
    };
    if (detail === "full") {
      if (attrNode.metadata.optionSet) attr.optionSet = attrNode.metadata.optionSet;
      if (attrNode.metadata.lookupTargets) attr.lookupTargets = attrNode.metadata.lookupTargets;
      if (attrNode.metadata.maxLength) attr.maxLength = attrNode.metadata.maxLength;
    }
    return attr;
  }).filter(Boolean);

  result.attributes = attributes;

  if (detail === "full") {
    const lookups = outgoing.filter((e) => e.type === EdgeType.LookupTo);
    result.lookupRelationships = lookups.map((e) => ({
      targetEntity: e.to.replace("entity:", ""),
      viaAttribute: e.metadata.viaAttribute,
    }));
  }

  return result;
}
```

- [ ] **Step 9: Run tests**

```bash
npx vitest run tests/tools/describeSqlObject.test.ts tests/tools/describeEntity.test.ts
```

Expected: All 8 tests PASS.

- [ ] **Step 10: Commit**

```bash
git add src/tools/stats.ts src/tools/listEnvironments.ts src/tools/spBody.ts src/tools/describeSqlObject.ts src/tools/describeEntity.ts tests/tools/describeSqlObject.test.ts tests/tools/describeEntity.test.ts
git commit -m "feat: core tools — stats, list environments, sp body, describe SQL object, describe entity"
```

---

### Task 13: Remaining Tools — search, enrich, dependencies, impact, diff, relationships, optionset, export

**Files:**
- Create: `src/tools/search.ts`
- Create: `src/tools/enrich.ts`
- Create: `src/tools/sqlDependencies.ts`
- Create: `src/tools/sqlImpact.ts`
- Create: `src/tools/sqlDiff.ts`
- Create: `src/tools/sqlSearch.ts`
- Create: `src/tools/entityRelationships.ts`
- Create: `src/tools/entitySearch.ts`
- Create: `src/tools/entityDiff.ts`
- Create: `src/tools/optionsetValues.ts`
- Create: `src/tools/export.ts`
- Create: `tests/tools/enrich.test.ts`
- Create: `tests/tools/search.test.ts`

- [ ] **Step 1: Write enrich test**

Create `tests/tools/enrich.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import { handleEnrich } from "../../src/tools/enrich.js";
import type { BoomerangGraphConfig } from "../../src/config.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const config: BoomerangGraphConfig = {
  environments: {
    testenv: {
      dbExportPath: join(fixtureRoot, "db-export/testenv"),
      schemaPath: join(fixtureRoot, "dataverse-schema/testenv"),
      default: true,
    },
  },
};

describe("handleEnrich", () => {
  it("enriches a mix of SQL and Dataverse names", () => {
    const manager = new GraphManager(config);
    const result = handleEnrich(manager, ["p_Test_Transform", "TestStaging", "alm_testentity"], "testenv");
    expect(result.objects).toHaveLength(3);
    const sp = result.objects.find((o) => o.name === "p_Test_Transform");
    expect(sp).toBeDefined();
    expect(sp!.type).toBe("sql_procedure");
    const entity = result.objects.find((o) => o.name === "alm_testentity");
    expect(entity).toBeDefined();
    expect(entity!.type).toBe("dv_entity");
  });

  it("marks unknown names", () => {
    const manager = new GraphManager(config);
    const result = handleEnrich(manager, ["NonExistent"], "testenv");
    expect(result.objects[0].type).toBe("unknown");
  });
});
```

- [ ] **Step 2: Write unified search test**

Create `tests/tools/search.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import { handleSearch } from "../../src/tools/search.js";
import type { BoomerangGraphConfig } from "../../src/config.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const config: BoomerangGraphConfig = {
  environments: {
    testenv: {
      dbExportPath: join(fixtureRoot, "db-export/testenv"),
      schemaPath: join(fixtureRoot, "dataverse-schema/testenv"),
      default: true,
    },
  },
};

describe("handleSearch", () => {
  it("finds SQL objects by name pattern", () => {
    const manager = new GraphManager(config);
    const result = handleSearch(manager, "Test", "testenv", "all");
    expect(result.results.length).toBeGreaterThan(0);
    const names = result.results.map((r) => r.name);
    expect(names).toContain("TestStaging");
    expect(names).toContain("p_Test_Transform");
  });

  it("finds Dataverse entities by name", () => {
    const manager = new GraphManager(config);
    const result = handleSearch(manager, "alm_test", "testenv", "all");
    expect(result.results.some((r) => r.name === "alm_testentity")).toBe(true);
  });

  it("filters by domain", () => {
    const manager = new GraphManager(config);
    const sqlOnly = handleSearch(manager, "Test", "testenv", "sql");
    expect(sqlOnly.results.every((r) => r.type.startsWith("sql_"))).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/tools/enrich.test.ts tests/tools/search.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Implement enrich.ts**

Create `src/tools/enrich.ts`:

```typescript
import type { GraphManager } from "../graph/manager.js";
import { NodeType, EdgeType } from "../graph/model.js";
import { parseNodeId } from "../utils/nodeId.js";
import { buildAdfContext } from "../utils/crossRef.js";

interface EnrichedObject {
  name: string;
  type: string;
  schema?: string;
  summary: Record<string, unknown>;
  adf_context?: ReturnType<typeof buildAdfContext>;
}

export function handleEnrich(
  manager: GraphManager,
  names: string[],
  environment: string | undefined,
) {
  const envName = environment ?? manager.getDefaultEnvironment();
  const { graph } = manager.ensureGraph(envName);
  const objects: EnrichedObject[] = [];

  for (const name of names) {
    const lcName = name.toLowerCase();
    const allNodes = graph.allNodes();
    const node = allNodes.find((n) => n.name.toLowerCase() === lcName);

    if (!node) {
      objects.push({ name, type: "unknown", summary: {} });
      continue;
    }

    const schema = (node.metadata.schema as string) ?? undefined;
    const obj: EnrichedObject = {
      name: node.name,
      type: node.type,
      schema,
      summary: {},
    };

    switch (node.type) {
      case NodeType.SqlTable:
        obj.summary = {
          columnCount: node.metadata.columnCount,
          columns: ((node.metadata.columns as Array<{ name: string }>) ?? []).map((c) => c.name),
        };
        obj.adf_context = buildAdfContext("table", `${schema}.${node.name}`, envName);
        break;
      case NodeType.SqlProcedure:
        obj.summary = { hasBody: true };
        obj.adf_context = buildAdfContext("sp", `${schema}.${node.name}`, envName);
        break;
      case NodeType.SqlView:
        obj.summary = {};
        obj.adf_context = buildAdfContext("view", `${schema}.${node.name}`, envName);
        break;
      case NodeType.SqlFunction:
        obj.summary = {};
        obj.adf_context = buildAdfContext("func", `${schema}.${node.name}`, envName);
        break;
      case NodeType.DvEntity:
        obj.summary = {
          displayName: node.metadata.displayName,
          attributeCount: node.metadata.attributeCount,
          primaryName: node.metadata.primaryName,
        };
        obj.adf_context = buildAdfContext("entity", node.name, envName);
        break;
      default:
        obj.summary = {};
    }

    const outgoing = graph.getOutgoing(node.id);
    const incoming = graph.getIncoming(node.id);
    obj.summary.outgoingEdges = outgoing.length;
    obj.summary.incomingEdges = incoming.length;

    objects.push(obj);
  }

  return { objects, environment: envName };
}
```

- [ ] **Step 5: Implement search.ts (unified search)**

Create `src/tools/search.ts`:

```typescript
import type { GraphManager } from "../graph/manager.js";
import { NodeType } from "../graph/model.js";

interface SearchResult {
  name: string;
  type: string;
  id: string;
  schema?: string;
  displayName?: string;
}

export function handleSearch(
  manager: GraphManager,
  query: string,
  environment: string | undefined,
  domain: "sql" | "dataverse" | "all",
) {
  const envName = environment ?? manager.getDefaultEnvironment();
  const { graph } = manager.ensureGraph(envName);
  const lcQuery = query.toLowerCase();
  const results: SearchResult[] = [];

  const allNodes = graph.allNodes();
  for (const node of allNodes) {
    if (node.type === NodeType.DvAttribute) continue;

    const isSql = [NodeType.SqlTable, NodeType.SqlProcedure, NodeType.SqlView, NodeType.SqlFunction].includes(node.type);
    const isDv = node.type === NodeType.DvEntity;

    if (domain === "sql" && !isSql) continue;
    if (domain === "dataverse" && !isDv) continue;

    if (node.name.toLowerCase().includes(lcQuery)) {
      results.push({
        name: node.name,
        type: node.type,
        id: node.id,
        schema: (node.metadata.schema as string) ?? undefined,
        displayName: (node.metadata.displayName as string) ?? undefined,
      });
    }
  }

  return { query, environment: envName, domain, resultCount: results.length, results };
}
```

- [ ] **Step 6: Implement sqlDependencies.ts**

Create `src/tools/sqlDependencies.ts`:

```typescript
import type { GraphManager } from "../graph/manager.js";
import { parseNodeId } from "../utils/nodeId.js";
import { NodeType } from "../graph/model.js";

export function handleSqlDependencies(
  manager: GraphManager,
  name: string,
  environment: string | undefined,
  direction: "upstream" | "downstream" | "both",
  depth: number,
) {
  const envName = environment ?? manager.getDefaultEnvironment();
  manager.ensureDeepSql(envName);
  const { graph } = manager.ensureGraph(envName);

  const allSql = [NodeType.SqlTable, NodeType.SqlProcedure, NodeType.SqlView, NodeType.SqlFunction];
  const node = graph.allNodes().find((n) => allSql.includes(n.type) && n.name.toLowerCase() === name.toLowerCase());

  if (!node) return { error: `SQL object '${name}' not found` };

  const downstream = direction !== "upstream" ? graph.traverseDownstream(node.id, depth) : [];
  const upstream = direction !== "downstream" ? graph.traverseUpstream(node.id, depth) : [];

  return {
    name: node.name,
    objectType: node.type,
    environment: envName,
    downstream: downstream.map((r) => ({
      name: r.node.name,
      type: r.node.type,
      depth: r.depth,
      via: r.path.map((e) => e.type),
    })),
    upstream: upstream.map((r) => ({
      name: r.node.name,
      type: r.node.type,
      depth: r.depth,
      via: r.path.map((e) => e.type),
    })),
  };
}
```

- [ ] **Step 7: Implement sqlImpact.ts**

Create `src/tools/sqlImpact.ts`:

```typescript
import type { GraphManager } from "../graph/manager.js";
import { NodeType } from "../graph/model.js";
import { parseNodeId } from "../utils/nodeId.js";

export function handleSqlImpact(
  manager: GraphManager,
  name: string,
  environment: string | undefined,
  depth: number,
) {
  const envName = environment ?? manager.getDefaultEnvironment();
  manager.ensureDeepSql(envName);
  const { graph } = manager.ensureGraph(envName);

  const allSql = [NodeType.SqlTable, NodeType.SqlProcedure, NodeType.SqlView, NodeType.SqlFunction];
  const node = graph.allNodes().find((n) => allSql.includes(n.type) && n.name.toLowerCase() === name.toLowerCase());

  if (!node) return { error: `SQL object '${name}' not found` };

  const upstream = graph.traverseUpstream(node.id, depth);
  const downstream = graph.traverseDownstream(node.id, depth);

  const byDepth = new Map<number, Array<{ name: string; type: string; direction: string; via: string[] }>>();

  for (const r of upstream) {
    if (!byDepth.has(r.depth)) byDepth.set(r.depth, []);
    byDepth.get(r.depth)!.push({
      name: r.node.name,
      type: r.node.type,
      direction: "upstream",
      via: r.path.map((e) => e.type),
    });
  }

  for (const r of downstream) {
    if (!byDepth.has(r.depth)) byDepth.set(r.depth, []);
    byDepth.get(r.depth)!.push({
      name: r.node.name,
      type: r.node.type,
      direction: "downstream",
      via: r.path.map((e) => e.type),
    });
  }

  const levels = Array.from(byDepth.entries())
    .sort(([a], [b]) => a - b)
    .map(([depth, items]) => ({ depth, items }));

  return {
    name: node.name,
    environment: envName,
    totalAffected: upstream.length + downstream.length,
    levels,
  };
}
```

- [ ] **Step 8: Implement sqlDiff.ts**

Create `src/tools/sqlDiff.ts`:

```typescript
import { readFileSync, existsSync } from "fs";
import type { GraphManager } from "../graph/manager.js";
import { NodeType } from "../graph/model.js";

export function handleSqlDiff(
  manager: GraphManager,
  name: string,
  envA: string,
  envB: string,
) {
  const { graph: graphA } = manager.ensureGraph(envA);
  const { graph: graphB } = manager.ensureGraph(envB);

  const allSql = [NodeType.SqlTable, NodeType.SqlProcedure, NodeType.SqlView, NodeType.SqlFunction];
  const nodeA = graphA.allNodes().find((n) => allSql.includes(n.type) && n.name.toLowerCase() === name.toLowerCase());
  const nodeB = graphB.allNodes().find((n) => allSql.includes(n.type) && n.name.toLowerCase() === name.toLowerCase());

  if (!nodeA && !nodeB) return { error: `'${name}' not found in either environment` };

  const result: Record<string, unknown> = {
    name,
    envA,
    envB,
    presentInA: !!nodeA,
    presentInB: !!nodeB,
  };

  if (nodeA && nodeB && nodeA.type === NodeType.SqlTable) {
    const colsA = (nodeA.metadata.columns as Array<{ name: string; type: string }>) ?? [];
    const colsB = (nodeB.metadata.columns as Array<{ name: string; type: string }>) ?? [];
    const colNamesA = new Set(colsA.map((c) => c.name));
    const colNamesB = new Set(colsB.map((c) => c.name));
    result.addedInB = colsB.filter((c) => !colNamesA.has(c.name));
    result.removedInB = colsA.filter((c) => !colNamesB.has(c.name));
    const typeDiffs: Array<{ column: string; typeA: string; typeB: string }> = [];
    for (const colA of colsA) {
      const colB = colsB.find((c) => c.name === colA.name);
      if (colB && colB.type !== colA.type) {
        typeDiffs.push({ column: colA.name, typeA: colA.type, typeB: colB.type });
      }
    }
    result.typeDiffs = typeDiffs;
  }

  if (nodeA && nodeB && (nodeA.type === NodeType.SqlProcedure || nodeA.type === NodeType.SqlFunction)) {
    const fileA = nodeA.metadata.filePath as string;
    const fileB = nodeB.metadata.filePath as string;
    const bodyA = existsSync(fileA) ? readFileSync(fileA, "utf-8") : "";
    const bodyB = existsSync(fileB) ? readFileSync(fileB, "utf-8") : "";
    result.bodiesMatch = bodyA === bodyB;
    if (bodyA !== bodyB) {
      result.bodyLengthA = bodyA.length;
      result.bodyLengthB = bodyB.length;
    }
  }

  return result;
}
```

- [ ] **Step 9: Implement sqlSearch.ts**

Create `src/tools/sqlSearch.ts`:

```typescript
import { readFileSync, existsSync } from "fs";
import type { GraphManager } from "../graph/manager.js";
import { NodeType } from "../graph/model.js";

export function handleSqlSearch(
  manager: GraphManager,
  query: string,
  environment: string | undefined,
  searchIn: "name" | "columns" | "body" | "all",
) {
  const envName = environment ?? manager.getDefaultEnvironment();
  const { graph } = manager.ensureGraph(envName);
  const lcQuery = query.toLowerCase();
  const results: Array<{ name: string; type: string; matchType: string; context?: string }> = [];

  const sqlTypes = [NodeType.SqlTable, NodeType.SqlProcedure, NodeType.SqlView, NodeType.SqlFunction];

  for (const node of graph.allNodes()) {
    if (!sqlTypes.includes(node.type)) continue;

    if ((searchIn === "name" || searchIn === "all") && node.name.toLowerCase().includes(lcQuery)) {
      results.push({ name: node.name, type: node.type, matchType: "name" });
      continue;
    }

    if ((searchIn === "columns" || searchIn === "all") && node.type === NodeType.SqlTable) {
      const cols = (node.metadata.columns as Array<{ name: string }>) ?? [];
      const matchCol = cols.find((c) => c.name.toLowerCase().includes(lcQuery));
      if (matchCol) {
        results.push({ name: node.name, type: node.type, matchType: "column", context: matchCol.name });
        continue;
      }
    }

    if ((searchIn === "body" || searchIn === "all") &&
        (node.type === NodeType.SqlProcedure || node.type === NodeType.SqlFunction)) {
      const filePath = node.metadata.filePath as string;
      if (filePath && existsSync(filePath)) {
        const body = readFileSync(filePath, "utf-8");
        if (body.toLowerCase().includes(lcQuery)) {
          results.push({ name: node.name, type: node.type, matchType: "body" });
        }
      }
    }
  }

  return { query, environment: envName, searchIn, resultCount: results.length, results };
}
```

- [ ] **Step 10: Implement entityRelationships.ts**

Create `src/tools/entityRelationships.ts`:

```typescript
import type { GraphManager } from "../graph/manager.js";
import { NodeType, EdgeType } from "../graph/model.js";

export function handleEntityRelationships(
  manager: GraphManager,
  entity: string,
  environment: string | undefined,
  direction: "outgoing" | "incoming" | "both",
) {
  const envName = environment ?? manager.getDefaultEnvironment();
  manager.ensureDeepDv(envName);
  const { graph } = manager.ensureGraph(envName);

  const node = graph.getNodesByType(NodeType.DvEntity)
    .find((n) => n.name.toLowerCase() === entity.toLowerCase());

  if (!node) return { error: `Entity '${entity}' not found` };

  const outgoing = direction !== "incoming"
    ? graph.getOutgoing(node.id).filter((e) => e.type === EdgeType.LookupTo).map((e) => ({
        targetEntity: e.to.replace("entity:", ""),
        viaAttribute: e.metadata.viaAttribute,
      }))
    : [];

  const incoming = direction !== "outgoing"
    ? graph.getIncoming(node.id).filter((e) => e.type === EdgeType.LookupTo).map((e) => ({
        sourceEntity: e.from.replace("entity:", ""),
        viaAttribute: e.metadata.viaAttribute,
      }))
    : [];

  return { entity: node.name, environment: envName, outgoing, incoming };
}
```

- [ ] **Step 11: Implement entitySearch.ts**

Create `src/tools/entitySearch.ts`:

```typescript
import type { GraphManager } from "../graph/manager.js";
import { NodeType, EdgeType } from "../graph/model.js";

export function handleEntitySearch(
  manager: GraphManager,
  query: string,
  environment: string | undefined,
  searchIn: "name" | "attributes" | "optionsets" | "all",
) {
  const envName = environment ?? manager.getDefaultEnvironment();
  const { graph } = manager.ensureGraph(envName);
  const lcQuery = query.toLowerCase();
  const results: Array<{ entity: string; matchType: string; context?: string }> = [];

  if (searchIn === "attributes" || searchIn === "optionsets" || searchIn === "all") {
    manager.ensureDeepDv(envName);
  }

  for (const node of graph.getNodesByType(NodeType.DvEntity)) {
    if ((searchIn === "name" || searchIn === "all") && node.name.toLowerCase().includes(lcQuery)) {
      results.push({ entity: node.name, matchType: "name" });
      continue;
    }

    if (searchIn === "attributes" || searchIn === "all") {
      const attrs = graph.getOutgoing(node.id)
        .filter((e) => e.type === EdgeType.HasAttribute)
        .map((e) => graph.getNode(e.to))
        .filter(Boolean);
      const match = attrs.find((a) => a!.name.toLowerCase().includes(lcQuery));
      if (match) {
        results.push({ entity: node.name, matchType: "attribute", context: match!.name });
        continue;
      }
    }

    if (searchIn === "optionsets" || searchIn === "all") {
      const attrs = graph.getOutgoing(node.id)
        .filter((e) => e.type === EdgeType.HasAttribute)
        .map((e) => graph.getNode(e.to))
        .filter(Boolean);
      for (const attr of attrs) {
        const optionSet = attr!.metadata.optionSet as Array<{ label: string }> | undefined;
        if (optionSet?.some((o) => o.label.toLowerCase().includes(lcQuery))) {
          results.push({ entity: node.name, matchType: "optionset", context: `${attr!.name}: ${lcQuery}` });
          break;
        }
      }
    }
  }

  return { query, environment: envName, searchIn, resultCount: results.length, results };
}
```

- [ ] **Step 12: Implement entityDiff.ts**

Create `src/tools/entityDiff.ts`:

```typescript
import type { GraphManager } from "../graph/manager.js";
import { NodeType } from "../graph/model.js";

export function handleEntityDiff(
  manager: GraphManager,
  entity: string,
  envA: string,
  envB: string,
) {
  const { graph: graphA } = manager.ensureGraph(envA);
  const { graph: graphB } = manager.ensureGraph(envB);

  const nodeA = graphA.getNodesByType(NodeType.DvEntity).find((n) => n.name.toLowerCase() === entity.toLowerCase());
  const nodeB = graphB.getNodesByType(NodeType.DvEntity).find((n) => n.name.toLowerCase() === entity.toLowerCase());

  if (!nodeA && !nodeB) return { error: `'${entity}' not found in either environment` };

  const attrsA = (nodeA?.metadata.attributeNames as string[]) ?? [];
  const attrsB = (nodeB?.metadata.attributeNames as string[]) ?? [];
  const setA = new Set(attrsA);
  const setB = new Set(attrsB);

  return {
    entity,
    envA,
    envB,
    presentInA: !!nodeA,
    presentInB: !!nodeB,
    attributeCountA: attrsA.length,
    attributeCountB: attrsB.length,
    addedInB: attrsB.filter((a) => !setA.has(a)),
    removedInB: attrsA.filter((a) => !setB.has(a)),
  };
}
```

- [ ] **Step 13: Implement optionsetValues.ts**

Create `src/tools/optionsetValues.ts`:

```typescript
import type { GraphManager } from "../graph/manager.js";
import { NodeType, EdgeType } from "../graph/model.js";

export function handleOptionsetValues(
  manager: GraphManager,
  entity: string,
  attribute: string,
  environment: string | undefined,
) {
  const envName = environment ?? manager.getDefaultEnvironment();
  manager.ensureDeepDv(envName);
  const { graph } = manager.ensureGraph(envName);

  const entityNode = graph.getNodesByType(NodeType.DvEntity)
    .find((n) => n.name.toLowerCase() === entity.toLowerCase());
  if (!entityNode) return { error: `Entity '${entity}' not found` };

  const attrEdge = graph.getOutgoing(entityNode.id)
    .filter((e) => e.type === EdgeType.HasAttribute)
    .find((e) => {
      const attrNode = graph.getNode(e.to);
      return attrNode && attrNode.name.toLowerCase() === attribute.toLowerCase();
    });

  if (!attrEdge) return { error: `Attribute '${attribute}' not found on '${entity}'` };

  const attrNode = graph.getNode(attrEdge.to)!;
  const optionSet = attrNode.metadata.optionSet as Array<{ value: number; label: string }> | undefined;

  return {
    entity,
    attribute: attrNode.name,
    attributeType: attrNode.metadata.attributeType,
    environment: envName,
    optionSet: optionSet ?? [],
  };
}
```

- [ ] **Step 14: Implement export.ts**

Create `src/tools/export.ts`:

```typescript
import type { GraphManager } from "../graph/manager.js";

export function handleExport(manager: GraphManager, environment: string | undefined) {
  const envName = environment ?? manager.getDefaultEnvironment();
  const { graph } = manager.ensureGraph(envName);
  return {
    environment: envName,
    nodes: graph.allNodes(),
    edges: graph.allEdges(),
    stats: graph.stats(),
  };
}
```

- [ ] **Step 15: Run tests**

```bash
npx vitest run tests/tools/enrich.test.ts tests/tools/search.test.ts
```

Expected: All 5 tests PASS.

- [ ] **Step 16: Commit**

```bash
git add src/tools/search.ts src/tools/enrich.ts src/tools/sqlDependencies.ts src/tools/sqlImpact.ts src/tools/sqlDiff.ts src/tools/sqlSearch.ts src/tools/entityRelationships.ts src/tools/entitySearch.ts src/tools/entityDiff.ts src/tools/optionsetValues.ts src/tools/export.ts tests/tools/enrich.test.ts tests/tools/search.test.ts
git commit -m "feat: remaining tools — search, enrich, dependencies, impact, diff, relationships, optionsets, export"
```

---

### Task 14: Tool Registration + Server Entry Point

**Files:**
- Create: `src/registerTools.ts`
- Create: `src/server.ts`

- [ ] **Step 1: Implement registerTools.ts**

Create `src/registerTools.ts`:

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GraphManager } from "./graph/manager.js";
import { handleStats } from "./tools/stats.js";
import { handleListEnvironments } from "./tools/listEnvironments.js";
import { handleSpBody } from "./tools/spBody.js";
import { handleDescribeSqlObject } from "./tools/describeSqlObject.js";
import { handleDescribeEntity } from "./tools/describeEntity.js";
import { handleSearch } from "./tools/search.js";
import { handleEnrich } from "./tools/enrich.js";
import { handleSqlDependencies } from "./tools/sqlDependencies.js";
import { handleSqlImpact } from "./tools/sqlImpact.js";
import { handleSqlDiff } from "./tools/sqlDiff.js";
import { handleSqlSearch } from "./tools/sqlSearch.js";
import { handleEntityRelationships } from "./tools/entityRelationships.js";
import { handleEntitySearch } from "./tools/entitySearch.js";
import { handleEntityDiff } from "./tools/entityDiff.js";
import { handleOptionsetValues } from "./tools/optionsetValues.js";
import { handleExport } from "./tools/export.js";

const envParam = z.string().optional().describe("Environment name. If omitted, uses the default.");

function json(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
}

export function registerTools(server: McpServer, manager: GraphManager): void {
  server.tool("bg_stats", "Overview stats: SQL/Dataverse object counts, edge counts, build time, staleness.", { environment: envParam }, async ({ environment }) => json(handleStats(manager, environment)));

  server.tool("bg_list_environments", "List configured environments with per-env stats.", {}, async () => json(handleListEnvironments(manager)));

  server.tool("bg_sp_body", "Return raw SQL body of a stored procedure or function.", { name: z.string().describe("SP or function name"), environment: envParam }, async ({ name, environment }) => json(handleSpBody(manager, name, environment)));

  server.tool("bg_describe_sql_object", "Deep describe for any SQL object (table, SP, view, function).", { name: z.string().describe("Object name"), environment: envParam, detail: z.enum(["summary", "full"]).default("summary").describe("Detail level") }, async ({ name, environment, detail }) => json(handleDescribeSqlObject(manager, name, environment, detail)));

  server.tool("bg_describe_entity", "Deep entity detail: attributes, types, required levels, option sets, lookups.", { entity: z.string().describe("Entity logical name"), environment: envParam, detail: z.enum(["summary", "attributes", "full"]).default("summary").describe("Detail level") }, async ({ entity, environment, detail }) => json(handleDescribeEntity(manager, entity, environment, detail)));

  server.tool("bg_search", "Unified search across SQL and Dataverse domains.", { query: z.string().describe("Search query"), environment: envParam, domain: z.enum(["sql", "dataverse", "all"]).default("all").describe("Domain filter") }, async ({ query, environment, domain }) => json(handleSearch(manager, query, environment, domain)));

  server.tool("bg_enrich", "Batch metadata lookup — auto-detects type and returns key stats for each name. Call after adf-graph queries to light up referenced objects.", { names: z.array(z.string()).describe("Object names to enrich"), environment: envParam }, async ({ names, environment }) => json(handleEnrich(manager, names, environment)));

  server.tool("bg_sql_search", "Search SQL objects by name, column, referenced table, or body content.", { query: z.string(), environment: envParam, searchIn: z.enum(["name", "columns", "body", "all"]).default("all") }, async ({ query, environment, searchIn }) => json(handleSqlSearch(manager, query, environment, searchIn)));

  server.tool("bg_sql_dependencies", "Dependency graph traversal for a SQL object.", { name: z.string(), environment: envParam, direction: z.enum(["upstream", "downstream", "both"]).default("both"), depth: z.number().default(3) }, async ({ name, environment, direction, depth }) => json(handleSqlDependencies(manager, name, environment, direction, depth)));

  server.tool("bg_sql_impact", "Blast radius if a SQL object changes.", { name: z.string(), environment: envParam, depth: z.number().default(3) }, async ({ name, environment, depth }) => json(handleSqlImpact(manager, name, environment, depth)));

  server.tool("bg_sql_diff", "Compare a SQL object across environments.", { name: z.string(), envA: z.string(), envB: z.string() }, async ({ name, envA, envB }) => json(handleSqlDiff(manager, name, envA, envB)));

  server.tool("bg_entity_relationships", "Entity relationship web — lookups to and from.", { entity: z.string(), environment: envParam, direction: z.enum(["outgoing", "incoming", "both"]).default("both") }, async ({ entity, environment, direction }) => json(handleEntityRelationships(manager, entity, environment, direction)));

  server.tool("bg_entity_search", "Search entities by name, attribute, or option set value.", { query: z.string(), environment: envParam, searchIn: z.enum(["name", "attributes", "optionsets", "all"]).default("all") }, async ({ query, environment, searchIn }) => json(handleEntitySearch(manager, query, environment, searchIn)));

  server.tool("bg_entity_diff", "Compare an entity across environments.", { entity: z.string(), envA: z.string(), envB: z.string() }, async ({ entity, envA, envB }) => json(handleEntityDiff(manager, entity, envA, envB)));

  server.tool("bg_optionset_values", "Return option set values for a picklist attribute.", { entity: z.string(), attribute: z.string(), environment: envParam }, async ({ entity, attribute, environment }) => json(handleOptionsetValues(manager, entity, attribute, environment)));

  server.tool("bg_export", "Export full graph as JSON for visualization clients.", { environment: envParam }, async ({ environment }) => json(handleExport(manager, environment)));
}
```

- [ ] **Step 2: Implement server.ts**

Create `src/server.ts`:

```typescript
#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRequire } from "module";
import { loadConfig } from "./config.js";
import { GraphManager } from "./graph/manager.js";
import { registerTools } from "./registerTools.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const config = loadConfig();
const manager = new GraphManager(config);

const server = new McpServer({
  name: "boomerang-graph",
  version,
});

registerTools(server, manager);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 3: Build the project**

```bash
npm run build
```

Expected: Clean build, no errors.

- [ ] **Step 4: Run all tests**

```bash
npm test
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/registerTools.ts src/server.ts
git commit -m "feat: tool registration and MCP server entry point"
```

---

### Task 15: adf-graph Cross-Reference Updates

**Files:**
- Modify: `C:\Users\shurley\source\repos\HurleySk\adf-graph\src\tools\describe.ts`
- Modify: other affected adf-graph tool files

This task adds `see_also` fields to adf-graph tool responses that reference SPs, tables, or entities. The changes are mechanical — add a `see_also` array to the return object of each affected tool handler.

- [ ] **Step 1: Create a cross-reference helper in adf-graph**

Create `C:\Users\shurley\source\repos\HurleySk\adf-graph\src\utils\boomerangRef.ts`:

```typescript
export interface SeeAlsoEntry {
  server: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
}

export function buildBoomerangEnrich(names: string[], environment: string): SeeAlsoEntry {
  return {
    server: "boomerang-graph",
    tool: "bg_enrich",
    args: { names, environment },
    reason: "Deep SQL/Dataverse detail for referenced objects",
  };
}
```

- [ ] **Step 2: Add see_also to describePipeline result**

In `adf-graph/src/tools/describe.ts`, after building the `DescribePipelineResult`, collect SP/table/entity names from activities and add:

```typescript
import { buildBoomerangEnrich } from "../utils/boomerangRef.js";

// At the end of handleDescribePipeline, before return:
const referencedNames: string[] = [];
if (result.activities) {
  for (const act of result.activities) {
    if (act.storedProcedureName) referencedNames.push(act.storedProcedureName);
  }
}
if (referencedNames.length > 0) {
  (result as Record<string, unknown>).see_also = [buildBoomerangEnrich(referencedNames, environment)];
}
```

- [ ] **Step 3: Add see_also to other affected tools**

Repeat the same pattern for: `describeStoredProcedure`, `describeTable`, `describeEntity`, `lineage`, `impact`, `traceConnection`, `entityCoverage`. Each collects referenced SP/table/entity names from its result and appends a `see_also` field.

- [ ] **Step 4: Build and test adf-graph**

```bash
cd C:\Users\shurley\source\repos\HurleySk\adf-graph
npm run build && npm test
```

Expected: Clean build, all tests pass. The new field is additive — existing tests are unaffected.

- [ ] **Step 5: Commit in adf-graph**

```bash
git add src/utils/boomerangRef.ts src/tools/
git commit -m "feat: add see_also cross-references to boomerang-graph in tool responses"
```

---

### Task 16: MCP Configuration + Integration Smoke Test

**Files:**
- Create: `boomerang-graph.json` (template config)
- Create: `tests/integration/smoke.test.ts`

- [ ] **Step 1: Create template config**

In the boomerang-graph repo, create `boomerang-graph.json`:

```json
{
  "environments": {
    "devqa": {
      "dbExportPath": "C:/Users/shurley/source/repos/HurleySk/boomerang-/db-export/devqa",
      "schemaPath": "C:/Users/shurley/source/repos/HurleySk/boomerang-/dataverse-schema/datadevqa",
      "default": true
    },
    "w3preprd": {
      "dbExportPath": "C:/Users/shurley/source/repos/HurleySk/boomerang-/db-export/w3preprd",
      "schemaPath": "C:/Users/shurley/source/repos/HurleySk/boomerang-/dataverse-schema/almwave3testpreprod"
    }
  }
}
```

- [ ] **Step 2: Write integration smoke test**

Create `tests/integration/smoke.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { join } from "path";
import { GraphManager } from "../../src/graph/manager.js";
import { handleStats } from "../../src/tools/stats.js";
import { handleSearch } from "../../src/tools/search.js";
import { handleEnrich } from "../../src/tools/enrich.js";
import type { BoomerangGraphConfig } from "../../src/config.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const config: BoomerangGraphConfig = {
  environments: {
    testenv: {
      dbExportPath: join(fixtureRoot, "db-export/testenv"),
      schemaPath: join(fixtureRoot, "dataverse-schema/testenv"),
      default: true,
    },
  },
};

describe("integration smoke", () => {
  it("full workflow: stats → search → enrich", () => {
    const manager = new GraphManager(config);

    const stats = handleStats(manager, "testenv");
    expect(stats.nodeCount).toBeGreaterThan(0);

    const searchResult = handleSearch(manager, "Test", "testenv", "all");
    expect(searchResult.results.length).toBeGreaterThan(0);

    const names = searchResult.results.slice(0, 3).map((r) => r.name);
    const enrichResult = handleEnrich(manager, names, "testenv");
    expect(enrichResult.objects).toHaveLength(names.length);
    for (const obj of enrichResult.objects) {
      expect(obj.type).not.toBe("unknown");
    }
  });
});
```

- [ ] **Step 3: Run all tests**

```bash
npm test
```

Expected: All tests PASS including integration smoke.

- [ ] **Step 4: Final build**

```bash
npm run build
```

Expected: Clean build.

- [ ] **Step 5: Commit**

```bash
git add boomerang-graph.json tests/integration/smoke.test.ts
git commit -m "feat: template config and integration smoke test"
```

- [ ] **Step 6: Add MCP config to boomerang repo**

Add to the boomerang- repo's `.mcp.json` (or the Claude Code MCP config):

```json
{
  "mcpServers": {
    "boomerang-graph": {
      "command": "node",
      "args": ["C:/Users/shurley/source/repos/HurleySk/boomerang-graph/dist/server.js"],
      "env": {
        "BOOMERANG_CONFIG": "C:/Users/shurley/source/repos/HurleySk/boomerang-graph/boomerang-graph.json"
      }
    }
  }
}
```

- [ ] **Step 7: Commit MCP config**

```bash
git add .mcp.json
git commit -m "feat: register boomerang-graph MCP server"
```
