# Dataverse Schema Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Dataverse entity metadata (from exported `_index.json` + per-entity JSON files) into the adf-graph dependency graph so lineage, validation, search, and deploy-readiness tools can work at the attribute level.

**Architecture:** New parser reads `_index.json` to create `DataverseEntity` + `DataverseAttribute` nodes with `HasAttribute` edges. A new builder pass (Pass 5) runs after SP column analysis. Tools that touch Dataverse data are enhanced to leverage the schema. Per-entity files are loaded lazily when tools need deep attribute detail (types, required level).

**Tech Stack:** TypeScript, Vitest, Node.js fs, MCP SDK (zod schemas)

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/graph/model.ts` | Add `DataverseAttribute` node type, `HasAttribute` edge type |
| Modify | `src/utils/nodeId.ts` | Add `dataverse_attribute` to `inferNodeType` |
| Modify | `src/config.ts` | Add optional `schemaPath` to `EnvironmentConfig`, validate it |
| Create | `src/parsers/dataverseSchema.ts` | Parse `_index.json`, lazy-load per-entity files, cache results |
| Modify | `src/graph/builder.ts` | Add Pass 5 (schema), accept `schemaPath` parameter |
| Modify | `src/graph/manager.ts` | Pass `schemaPath` through to builder, track schema staleness |
| Create | `src/tools/describeEntity.ts` | New `graph_describe_entity` tool handler |
| Modify | `src/tools/lineage.ts` | Extend lineage to traverse through attributes |
| Modify | `src/tools/validate.ts` | Add Dataverse schema validation rules |
| Modify | `src/tools/deployReadiness.ts` | Add `dataverseSchemaValidation` section |
| Modify | `src/tools/enhancedSearch.ts` | Add entity/attribute metadata search |
| Modify | `src/server.ts` | Register `graph_describe_entity` tool, update `graph_add_environment` schema |
| Modify | `src/constants.ts` | No changes needed (staleness uses separate mechanism) |
| Create | `tests/fixtures/dataverse-schema/_index.json` | Test fixture: minimal schema index |
| Create | `tests/fixtures/dataverse-schema/test-env/alm_organization.json` | Test fixture: per-entity detail |
| Create | `tests/parsers/dataverseSchema.test.ts` | Parser unit tests |
| Modify | `tests/graph/builder.test.ts` | Builder tests with schemaPath |
| Modify | `tests/config.test.ts` | Config validation tests for schemaPath |
| Create | `tests/tools/describeEntity.test.ts` | Describe entity tool tests |
| Modify | `tests/tools/lineage.test.ts` | Lineage tests with schema data |
| Modify | `tests/tools/validate.test.ts` | Validation tests with schema rules |
| Modify | `tests/tools/deployReadiness.test.ts` | Deploy readiness tests with schema validation |
| Modify | `tests/tools/enhancedSearch.test.ts` | Search tests for entity/attribute nodes |
| Modify | `package.json` | Bump version to 0.10.0 |
| Modify | `server.json` | Bump version, add `graph_describe_entity` tool |

---

### Task 1: Data Model — New Node and Edge Types

**Files:**
- Modify: `src/graph/model.ts:1-23`
- Modify: `src/utils/nodeId.ts:25-38`
- Test: `tests/utils/nodeId.test.ts`
- Test: `tests/graph/model.test.ts`

- [ ] **Step 1: Write failing test for inferNodeType with dataverse_attribute**

In `tests/utils/nodeId.test.ts`, add:

```typescript
it("infers DataverseAttribute from dataverse_attribute prefix", () => {
  expect(inferNodeType("dataverse_attribute:alm_org.alm_name")).toBe(NodeType.DataverseAttribute);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/utils/nodeId.test.ts`
Expected: FAIL — `NodeType.DataverseAttribute` does not exist

- [ ] **Step 3: Add DataverseAttribute and HasAttribute to model.ts**

In `src/graph/model.ts`, add to `NodeType` enum:

```typescript
DataverseAttribute = "dataverse_attribute",
```

Add to `EdgeType` enum:

```typescript
HasAttribute = "has_attribute",
```

- [ ] **Step 4: Update inferNodeType in nodeId.ts**

In `src/utils/nodeId.ts`, add case to `inferNodeType`:

```typescript
case "dataverse_attribute": return NodeType.DataverseAttribute;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/utils/nodeId.test.ts tests/graph/model.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/graph/model.ts src/utils/nodeId.ts tests/utils/nodeId.test.ts
git commit -m "feat: add DataverseAttribute node type and HasAttribute edge type"
```

---

### Task 2: Config — Add schemaPath to EnvironmentConfig

**Files:**
- Modify: `src/config.ts:8-9` (EnvironmentConfig interface)
- Modify: `src/config.ts:76-129` (validateConfig function)
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write failing tests for schemaPath validation**

In `tests/config.test.ts`, add a new `describe("schemaPath in config", ...)` block:

```typescript
describe("schemaPath in config", () => {
  it("parses schemaPath for an environment", () => {
    const cfgPath = writeConfig("schema-path.json", {
      environments: {
        main: {
          path: "/some/path",
          default: true,
          schemaPath: "/schema/almwave3",
        },
      },
    });
    setEnv({ ADF_CONFIG: cfgPath });

    const config = loadConfig();
    expect(config.environments["main"].schemaPath).toBe("/schema/almwave3");
  });

  it("defaults schemaPath to undefined when not provided", () => {
    const cfgPath = writeConfig("no-schema.json", {
      environments: {
        main: { path: "/some/path", default: true },
      },
    });
    setEnv({ ADF_CONFIG: cfgPath });

    const config = loadConfig();
    expect(config.environments["main"].schemaPath).toBeUndefined();
  });

  it("rejects non-string schemaPath", () => {
    const cfgPath = writeConfig("bad-schema.json", {
      environments: {
        main: { path: "/some/path", schemaPath: 123 },
      },
    });
    setEnv({ ADF_CONFIG: cfgPath });
    expect(() => loadConfig()).toThrow(/schemaPath.*must be a non-empty string/);
  });

  it("rejects empty string schemaPath", () => {
    const cfgPath = writeConfig("empty-schema.json", {
      environments: {
        main: { path: "/some/path", schemaPath: "" },
      },
    });
    setEnv({ ADF_CONFIG: cfgPath });
    expect(() => loadConfig()).toThrow(/schemaPath.*must be a non-empty string/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL — schemaPath not recognized

- [ ] **Step 3: Add schemaPath to EnvironmentConfig interface**

In `src/config.ts`, update the interface:

```typescript
export interface EnvironmentConfig {
  path: string;
  default?: boolean;
  overlays?: string[];
  schemaPath?: string;
}
```

- [ ] **Step 4: Add schemaPath validation in validateConfig**

In `src/config.ts` `validateConfig`, after the overlays validation block, add:

```typescript
let schemaPath: string | undefined;
if (envObj.schemaPath !== undefined) {
  if (typeof envObj.schemaPath !== "string" || !envObj.schemaPath) {
    throw new Error(
      `adf-graph: environment '${name}' in '${source}': schemaPath must be a non-empty string`,
    );
  }
  schemaPath = envObj.schemaPath;
}
```

Update the environment assignment to include schemaPath:

```typescript
environments[name] = {
  path: envObj.path,
  ...(envObj.default === true ? { default: true } : {}),
  ...(overlays ? { overlays } : {}),
  ...(schemaPath ? { schemaPath } : {}),
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/config.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add optional schemaPath to environment config"
```

---

### Task 3: Test Fixtures — Dataverse Schema Files

**Files:**
- Create: `tests/fixtures/dataverse-schema/_index.json`
- Create: `tests/fixtures/dataverse-schema/test-env/alm_organization.json`

- [ ] **Step 1: Create the schema index fixture**

Create `tests/fixtures/dataverse-schema/_index.json`:

```json
{
  "generated": "2026-01-01T00:00:00Z",
  "entityCount": 3,
  "entities": [
    {
      "logicalName": "alm_organization",
      "displayName": "Organization",
      "entitySetName": "alm_organizations",
      "description": "Organization entity",
      "primaryId": "alm_organizationid",
      "primaryName": "alm_name",
      "attributeCount": 5,
      "file": "alm_organization.json",
      "attributes": "alm_organizationid, alm_name, alm_orgcode, alm_orgtype, createdon"
    },
    {
      "logicalName": "businessunit",
      "displayName": "Business Unit",
      "entitySetName": "businessunits",
      "description": "Business unit entity",
      "primaryId": "businessunitid",
      "primaryName": "name",
      "attributeCount": 3,
      "file": "businessunit.json",
      "attributes": "businessunitid, name, parentbusinessunitid"
    },
    {
      "logicalName": "alm_notinenv",
      "displayName": "Not In Env",
      "entitySetName": "alm_notinenvs",
      "description": "Entity in index but not in environment subdirectory",
      "primaryId": "alm_notinenvid",
      "primaryName": "alm_name",
      "attributeCount": 2,
      "file": "alm_notinenv.json",
      "attributes": "alm_notinenvid, alm_name"
    }
  ]
}
```

- [ ] **Step 2: Create the per-entity detail fixture**

Create `tests/fixtures/dataverse-schema/test-env/alm_organization.json`:

```json
{
  "LogicalName": "alm_organization",
  "PrimaryNameAttribute": "alm_name",
  "PrimaryIdAttribute": "alm_organizationid",
  "SchemaName": "alm_Organization",
  "EntitySetName": "alm_organizations",
  "DisplayName": {
    "UserLocalizedLabel": { "Label": "Organization" }
  },
  "Attributes": [
    {
      "LogicalName": "alm_organizationid",
      "AttributeType": "Uniqueidentifier",
      "IsPrimaryId": true,
      "IsValidForCreate": true,
      "IsValidForUpdate": false,
      "IsCustomAttribute": false,
      "DisplayName": { "UserLocalizedLabel": { "Label": "Organization ID" } },
      "RequiredLevel": { "Value": "Required" }
    },
    {
      "LogicalName": "alm_name",
      "AttributeType": "String",
      "IsPrimaryId": false,
      "IsValidForCreate": true,
      "IsValidForUpdate": true,
      "IsCustomAttribute": true,
      "DisplayName": { "UserLocalizedLabel": { "Label": "Name" } },
      "RequiredLevel": { "Value": "Required" }
    },
    {
      "LogicalName": "alm_orgcode",
      "AttributeType": "String",
      "IsPrimaryId": false,
      "IsValidForCreate": true,
      "IsValidForUpdate": true,
      "IsCustomAttribute": true,
      "DisplayName": { "UserLocalizedLabel": { "Label": "Org Code" } },
      "RequiredLevel": { "Value": "None" }
    },
    {
      "LogicalName": "alm_orgtype",
      "AttributeType": "Picklist",
      "IsPrimaryId": false,
      "IsValidForCreate": true,
      "IsValidForUpdate": true,
      "IsCustomAttribute": true,
      "DisplayName": { "UserLocalizedLabel": { "Label": "Org Type" } },
      "RequiredLevel": { "Value": "Recommended" }
    },
    {
      "LogicalName": "createdon",
      "AttributeType": "DateTime",
      "IsPrimaryId": false,
      "IsValidForCreate": false,
      "IsValidForUpdate": false,
      "IsCustomAttribute": false,
      "DisplayName": { "UserLocalizedLabel": { "Label": "Created On" } },
      "RequiredLevel": { "Value": "None" }
    }
  ],
  "Keys": []
}
```

- [ ] **Step 3: Create a minimal businessunit detail fixture**

Create `tests/fixtures/dataverse-schema/test-env/businessunit.json`:

```json
{
  "LogicalName": "businessunit",
  "PrimaryNameAttribute": "name",
  "PrimaryIdAttribute": "businessunitid",
  "SchemaName": "BusinessUnit",
  "EntitySetName": "businessunits",
  "DisplayName": {
    "UserLocalizedLabel": { "Label": "Business Unit" }
  },
  "Attributes": [
    {
      "LogicalName": "businessunitid",
      "AttributeType": "Uniqueidentifier",
      "IsPrimaryId": true,
      "IsValidForCreate": true,
      "IsValidForUpdate": false,
      "IsCustomAttribute": false,
      "DisplayName": { "UserLocalizedLabel": { "Label": "Business Unit ID" } },
      "RequiredLevel": { "Value": "Required" }
    },
    {
      "LogicalName": "name",
      "AttributeType": "String",
      "IsPrimaryId": false,
      "IsValidForCreate": true,
      "IsValidForUpdate": true,
      "IsCustomAttribute": false,
      "DisplayName": { "UserLocalizedLabel": { "Label": "Name" } },
      "RequiredLevel": { "Value": "Required" }
    },
    {
      "LogicalName": "parentbusinessunitid",
      "AttributeType": "Lookup",
      "IsPrimaryId": false,
      "IsValidForCreate": true,
      "IsValidForUpdate": true,
      "IsCustomAttribute": false,
      "DisplayName": { "UserLocalizedLabel": { "Label": "Parent Business Unit" } },
      "RequiredLevel": { "Value": "None" }
    }
  ],
  "Keys": []
}
```

- [ ] **Step 4: Commit fixtures**

```bash
git add tests/fixtures/dataverse-schema/
git commit -m "test: add Dataverse schema fixtures for schema integration tests"
```

---

### Task 4: Schema Parser — parseSchemaIndex and loadEntityDetail

**Files:**
- Create: `src/parsers/dataverseSchema.ts`
- Create: `tests/parsers/dataverseSchema.test.ts`

- [ ] **Step 1: Write failing tests for parseSchemaIndex**

Create `tests/parsers/dataverseSchema.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { join } from "path";
import { parseSchemaIndex, loadEntityDetail, clearEntityDetailCache } from "../../src/parsers/dataverseSchema.js";
import { NodeType, EdgeType } from "../../src/graph/model.js";

const schemaRoot = join(import.meta.dirname, "../fixtures/dataverse-schema");
const schemaPath = join(schemaRoot, "test-env");

describe("parseSchemaIndex", () => {
  it("creates entity nodes from index entries that have files in the env directory", () => {
    const result = parseSchemaIndex(schemaPath);
    const entityNodes = result.nodes.filter((n) => n.type === NodeType.DataverseEntity);
    expect(entityNodes).toHaveLength(2);
    const names = entityNodes.map((n) => n.name);
    expect(names).toContain("alm_organization");
    expect(names).toContain("businessunit");
  });

  it("skips entities without per-entity files in the env directory", () => {
    const result = parseSchemaIndex(schemaPath);
    const entityNodes = result.nodes.filter((n) => n.type === NodeType.DataverseEntity);
    const names = entityNodes.map((n) => n.name);
    expect(names).not.toContain("alm_notinenv");
  });

  it("creates attribute nodes for each attribute in an entity", () => {
    const result = parseSchemaIndex(schemaPath);
    const attrNodes = result.nodes.filter((n) => n.type === NodeType.DataverseAttribute);
    expect(attrNodes.some((n) => n.id === "dataverse_attribute:alm_organization.alm_name")).toBe(true);
    expect(attrNodes.some((n) => n.id === "dataverse_attribute:alm_organization.alm_orgcode")).toBe(true);
    expect(attrNodes.some((n) => n.id === "dataverse_attribute:businessunit.name")).toBe(true);
  });

  it("creates HasAttribute edges from entity to each attribute", () => {
    const result = parseSchemaIndex(schemaPath);
    const hasAttrEdges = result.edges.filter((e) => e.type === EdgeType.HasAttribute);
    expect(hasAttrEdges.some((e) =>
      e.from === "dataverse_entity:alm_organization" &&
      e.to === "dataverse_attribute:alm_organization.alm_name"
    )).toBe(true);
  });

  it("populates entity node metadata from index", () => {
    const result = parseSchemaIndex(schemaPath);
    const orgNode = result.nodes.find((n) => n.id === "dataverse_entity:alm_organization");
    expect(orgNode).toBeDefined();
    expect(orgNode!.metadata.displayName).toBe("Organization");
    expect(orgNode!.metadata.entitySetName).toBe("alm_organizations");
    expect(orgNode!.metadata.primaryId).toBe("alm_organizationid");
    expect(orgNode!.metadata.primaryName).toBe("alm_name");
    expect(orgNode!.metadata.attributeCount).toBe(5);
    expect(orgNode!.metadata.schemaFile).toBe("alm_organization.json");
  });

  it("populates attribute node metadata with entityLogicalName", () => {
    const result = parseSchemaIndex(schemaPath);
    const attrNode = result.nodes.find((n) => n.id === "dataverse_attribute:alm_organization.alm_name");
    expect(attrNode).toBeDefined();
    expect(attrNode!.metadata.entityLogicalName).toBe("alm_organization");
  });

  it("reports entityCount in result", () => {
    const result = parseSchemaIndex(schemaPath);
    expect(result.entityCount).toBe(2);
  });

  it("returns a warning when _index.json is not found", () => {
    const result = parseSchemaIndex("/nonexistent/path");
    expect(result.nodes).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("_index.json");
  });
});

describe("loadEntityDetail", () => {
  beforeEach(() => {
    clearEntityDetailCache();
  });

  it("loads attribute details from per-entity file", () => {
    const detail = loadEntityDetail(schemaPath, "alm_organization.json");
    expect(detail).not.toBeNull();
    expect(detail!.attributes).toHaveLength(5);

    const nameAttr = detail!.attributes.find((a) => a.logicalName === "alm_name");
    expect(nameAttr).toBeDefined();
    expect(nameAttr!.attributeType).toBe("String");
    expect(nameAttr!.requiredLevel).toBe("Required");
    expect(nameAttr!.isValidForCreate).toBe(true);
    expect(nameAttr!.isValidForUpdate).toBe(true);
    expect(nameAttr!.isCustomAttribute).toBe(true);
    expect(nameAttr!.displayName).toBe("Name");
  });

  it("identifies read-only attributes", () => {
    const detail = loadEntityDetail(schemaPath, "alm_organization.json");
    const createdOn = detail!.attributes.find((a) => a.logicalName === "createdon");
    expect(createdOn!.isValidForCreate).toBe(false);
    expect(createdOn!.isValidForUpdate).toBe(false);
  });

  it("returns null for nonexistent file", () => {
    const detail = loadEntityDetail(schemaPath, "does_not_exist.json");
    expect(detail).toBeNull();
  });

  it("caches results across repeated calls", () => {
    const detail1 = loadEntityDetail(schemaPath, "alm_organization.json");
    const detail2 = loadEntityDetail(schemaPath, "alm_organization.json");
    expect(detail1).toBe(detail2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/parsers/dataverseSchema.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement parseSchemaIndex, loadEntityDetail, and clearEntityDetailCache**

Create `src/parsers/dataverseSchema.ts`:

```typescript
import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { GraphNode, GraphEdge, NodeType, EdgeType } from "../graph/model.js";

export interface SchemaParseResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
  entityCount: number;
}

export interface AttributeDetail {
  logicalName: string;
  attributeType: string;
  requiredLevel: string;
  isValidForCreate: boolean;
  isValidForUpdate: boolean;
  displayName: string;
  isCustomAttribute: boolean;
}

export interface EntityDetail {
  logicalName: string;
  attributes: AttributeDetail[];
}

interface IndexEntry {
  logicalName: string;
  displayName: string;
  entitySetName: string;
  description: string;
  primaryId: string;
  primaryName: string;
  attributeCount: number;
  file: string;
  attributes: string;
}

interface IndexFile {
  generated: string;
  entityCount: number;
  entities: IndexEntry[];
}

const entityDetailCache = new Map<string, EntityDetail>();

export function clearEntityDetailCache(): void {
  entityDetailCache.clear();
}

export function parseSchemaIndex(schemaPath: string): SchemaParseResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  const indexPath = join(dirname(schemaPath), "_index.json");
  if (!existsSync(indexPath)) {
    warnings.push(`Dataverse schema _index.json not found at '${indexPath}' — skipping schema parsing`);
    return { nodes, edges, warnings, entityCount: 0 };
  }

  let index: IndexFile;
  try {
    index = JSON.parse(readFileSync(indexPath, "utf-8")) as IndexFile;
  } catch (err) {
    warnings.push(`Failed to parse _index.json at '${indexPath}': ${String(err)}`);
    return { nodes, edges, warnings, entityCount: 0 };
  }

  let entityCount = 0;

  for (const entry of index.entities) {
    const entityFilePath = join(schemaPath, entry.file);
    if (!existsSync(entityFilePath)) continue;

    entityCount++;

    const entityId = `${NodeType.DataverseEntity}:${entry.logicalName}`;
    const entityNode: GraphNode = {
      id: entityId,
      type: NodeType.DataverseEntity,
      name: entry.logicalName,
      metadata: {
        displayName: entry.displayName,
        entitySetName: entry.entitySetName,
        primaryId: entry.primaryId,
        primaryName: entry.primaryName,
        attributeCount: entry.attributeCount,
        schemaFile: entry.file,
      },
    };
    nodes.push(entityNode);

    const attrNames = entry.attributes
      .split(",")
      .map((a) => a.trim())
      .filter((a) => a.length > 0);

    for (const attrName of attrNames) {
      const attrId = `${NodeType.DataverseAttribute}:${entry.logicalName}.${attrName}`;
      const attrNode: GraphNode = {
        id: attrId,
        type: NodeType.DataverseAttribute,
        name: `${entry.logicalName}.${attrName}`,
        metadata: {
          entityLogicalName: entry.logicalName,
        },
      };
      nodes.push(attrNode);

      edges.push({
        from: entityId,
        to: attrId,
        type: EdgeType.HasAttribute,
        metadata: {},
      });
    }
  }

  return { nodes, edges, warnings, entityCount };
}

export function loadEntityDetail(schemaPath: string, schemaFile: string): EntityDetail | null {
  const cacheKey = `${schemaPath}:${schemaFile}`;
  const cached = entityDetailCache.get(cacheKey);
  if (cached) return cached;

  const filePath = join(schemaPath, schemaFile);
  if (!existsSync(filePath)) return null;

  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return null;
  }

  const logicalName = raw.LogicalName as string;
  const rawAttrs = (raw.Attributes ?? []) as Array<Record<string, unknown>>;

  const attributes: AttributeDetail[] = rawAttrs.map((attr) => {
    const displayNameObj = attr.DisplayName as Record<string, unknown> | undefined;
    const userLabel = displayNameObj?.UserLocalizedLabel as Record<string, unknown> | undefined;
    const requiredObj = attr.RequiredLevel as Record<string, unknown> | undefined;

    return {
      logicalName: attr.LogicalName as string,
      attributeType: attr.AttributeType as string,
      requiredLevel: (requiredObj?.Value as string) ?? "None",
      isValidForCreate: (attr.IsValidForCreate as boolean) ?? false,
      isValidForUpdate: (attr.IsValidForUpdate as boolean) ?? false,
      displayName: (userLabel?.Label as string) ?? "",
      isCustomAttribute: (attr.IsCustomAttribute as boolean) ?? false,
    };
  });

  const detail: EntityDetail = { logicalName, attributes };
  entityDetailCache.set(cacheKey, detail);
  return detail;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/parsers/dataverseSchema.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite to check for regressions**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/parsers/dataverseSchema.ts tests/parsers/dataverseSchema.test.ts
git commit -m "feat: add Dataverse schema parser with index parsing and lazy entity detail loading"
```

---

### Task 5: Builder — Add Schema Pass

**Files:**
- Modify: `src/graph/builder.ts:1-13` (imports), `src/graph/builder.ts:128` (function signature), `src/graph/builder.ts:232-254` (add Pass 5 before stubs)
- Test: `tests/graph/builder.test.ts`

- [ ] **Step 1: Write failing tests for builder with schemaPath**

In `tests/graph/builder.test.ts`, add:

```typescript
import { NodeType, EdgeType } from "../../src/graph/model.js";

const schemaPath = join(import.meta.dirname, "../fixtures/dataverse-schema/test-env");

describe("buildGraph with schemaPath", () => {
  it("creates DataverseEntity nodes from schema index", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const entities = graph.getNodesByType(NodeType.DataverseEntity);
    expect(entities.some((n) => n.name === "alm_organization")).toBe(true);
    expect(entities.some((n) => n.name === "businessunit")).toBe(true);
  });

  it("creates DataverseAttribute nodes from schema index", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const attrs = graph.getNodesByType(NodeType.DataverseAttribute);
    expect(attrs.some((n) => n.id === "dataverse_attribute:alm_organization.alm_name")).toBe(true);
  });

  it("replaces stub entity nodes with schema-enriched nodes", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const orgEntity = graph.getNode("dataverse_entity:alm_organization");
    expect(orgEntity).toBeDefined();
    expect(orgEntity!.metadata.stub).toBeFalsy();
    expect(orgEntity!.metadata.displayName).toBe("Organization");
    expect(orgEntity!.metadata.entitySetName).toBe("alm_organizations");
  });

  it("creates HasAttribute edges from entity to attributes", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const outgoing = graph.getOutgoing("dataverse_entity:alm_organization");
    const hasAttr = outgoing.filter((e) => e.type === EdgeType.HasAttribute);
    expect(hasAttr.length).toBeGreaterThanOrEqual(5);
  });

  it("builds normally without schemaPath", () => {
    const { graph } = buildGraph(fixtureRoot);
    const attrs = graph.getNodesByType(NodeType.DataverseAttribute);
    expect(attrs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/graph/builder.test.ts`
Expected: FAIL — buildGraph doesn't accept schemaPath

- [ ] **Step 3: Integrate schema pass into builder**

In `src/graph/builder.ts`:

Add import at top:

```typescript
import { parseSchemaIndex } from "../parsers/dataverseSchema.js";
```

Change the function signature:

```typescript
export function buildGraph(rootPath: string, schemaPath?: string): BuildResult {
```

Add Pass 5 after the SP column mappings block (before the stub pass). The schema merge needs to handle replacing stubs, so use a custom merge that calls `replaceNode` for existing entity nodes:

```typescript
  // ── Pass 5: Dataverse Schema ──────────────────────────────────────────
  if (schemaPath) {
    const schemaResult = parseSchemaIndex(schemaPath);
    warnings.push(...schemaResult.warnings);
    for (const node of schemaResult.nodes) {
      const existing = graph.getNode(node.id);
      if (existing && existing.metadata.stub) {
        graph.replaceNode(node);
      } else if (!existing) {
        graph.addNode(node);
      }
    }
    for (const edge of schemaResult.edges) {
      graph.addEdge(edge);
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/graph/builder.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/graph/builder.ts tests/graph/builder.test.ts
git commit -m "feat: add builder Pass 5 for Dataverse schema integration"
```

---

### Task 6: Manager — Pass schemaPath and Track Staleness

**Files:**
- Modify: `src/graph/manager.ts`
- Test: `tests/graph/manager.test.ts`

- [ ] **Step 1: Write failing tests for manager schema integration**

In `tests/graph/manager.test.ts`, add tests (adjust to match existing test patterns — use a config with schemaPath):

```typescript
describe("schema integration", () => {
  it("passes schemaPath to builder when configured", () => {
    const schemaPath = join(import.meta.dirname, "../fixtures/dataverse-schema/test-env");
    const config: AdfGraphConfig = {
      environments: {
        test: {
          path: join(import.meta.dirname, "../fixtures"),
          default: true,
          schemaPath,
        },
      },
    };
    const mgr = new GraphManager(config);
    const { graph } = mgr.ensureGraph("test");
    const entities = graph.getNodesByType(NodeType.DataverseEntity);
    expect(entities.some((n) => n.metadata.displayName === "Organization")).toBe(true);
  });

  it("builds without schema when schemaPath is not configured", () => {
    const config: AdfGraphConfig = {
      environments: {
        test: {
          path: join(import.meta.dirname, "../fixtures"),
          default: true,
        },
      },
    };
    const mgr = new GraphManager(config);
    const { graph } = mgr.ensureGraph("test");
    const attrs = graph.getNodesByType(NodeType.DataverseAttribute);
    expect(attrs).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/graph/manager.test.ts`
Expected: FAIL — manager doesn't pass schemaPath to builder

- [ ] **Step 3: Update manager to resolve and pass schemaPath**

In `src/graph/manager.ts`:

Add imports:

```typescript
import { existsSync, statSync } from "fs";
import { join } from "path";
import { clearEntityDetailCache } from "../parsers/dataverseSchema.js";
```

Add a field to track schema staleness:

```typescript
private schemaIndexMtimes: Map<string, number> = new Map();
```

Add a method to resolve schemaPath for any environment:

```typescript
private resolveSchemaPath(envName: string): string | undefined {
  const cfg = this.config.environments[envName];
  if (cfg?.schemaPath) return cfg.schemaPath;
  const rt = this.runtimeEnvs.get(envName);
  return rt?.schemaPath;
}
```

Update `runtimeEnvs` type to include optional schemaPath:

```typescript
private runtimeEnvs: Map<string, { path: string; overlays: string[]; schemaPath?: string }> = new Map();
```

Update `addEnvironment` to accept schemaPath:

```typescript
addEnvironment(name: string, path: string, overlays?: string[], schemaPath?: string): void {
  // ... existing validation ...
  this.runtimeEnvs.set(name, { path, overlays: overlays ?? [], schemaPath });
  // ... rest unchanged ...
}
```

In `ensureGraph`, update the build call and add schema staleness check:

```typescript
// After checking existing && !existing.staleness.isStale():
const schemaPath = this.resolveSchemaPath(envName);
if (existing && !existing.staleness.isStale() && !this.isSchemaStale(envName, schemaPath)) {
  return { ... };
}

// Build call:
const result = buildGraph(envPath, schemaPath);

// After staleness.markBuilt():
this.markSchemaBuilt(envName, schemaPath);
clearEntityDetailCache();
```

Add schema staleness helpers:

```typescript
private isSchemaStale(envName: string, schemaPath?: string): boolean {
  if (!schemaPath) return false;
  const indexPath = join(schemaPath, "..", "_index.json");
  if (!existsSync(indexPath)) return false;
  try {
    const mtime = statSync(indexPath).mtimeMs;
    const lastBuilt = this.schemaIndexMtimes.get(envName);
    return lastBuilt === undefined || mtime > lastBuilt;
  } catch {
    return false;
  }
}

private markSchemaBuilt(envName: string, schemaPath?: string): void {
  if (!schemaPath) return;
  const indexPath = join(schemaPath, "..", "_index.json");
  if (!existsSync(indexPath)) return;
  try {
    const mtime = statSync(indexPath).mtimeMs;
    this.schemaIndexMtimes.set(envName, mtime);
  } catch {
    // ignore
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/graph/manager.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/graph/manager.ts tests/graph/manager.test.ts
git commit -m "feat: manager passes schemaPath to builder and tracks schema staleness"
```

---

### Task 7: New Tool — graph_describe_entity

**Files:**
- Create: `src/tools/describeEntity.ts`
- Create: `tests/tools/describeEntity.test.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Write failing tests for describeEntity**

Create `tests/tools/describeEntity.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { join } from "path";
import { buildGraph } from "../../src/graph/builder.js";
import { handleDescribeEntity } from "../../src/tools/describeEntity.js";
import { clearEntityDetailCache } from "../../src/parsers/dataverseSchema.js";

const fixtureRoot = join(import.meta.dirname, "../fixtures");
const schemaPath = join(import.meta.dirname, "../fixtures/dataverse-schema/test-env");

describe("handleDescribeEntity", () => {
  beforeEach(() => {
    clearEntityDetailCache();
  });

  it("returns entity metadata at summary depth", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDescribeEntity(graph, "alm_organization", "summary", schemaPath);
    expect(result.entity).toBe("alm_organization");
    expect(result.displayName).toBe("Organization");
    expect(result.entitySetName).toBe("alm_organizations");
    expect(result.primaryId).toBe("alm_organizationid");
    expect(result.primaryName).toBe("alm_name");
    expect(result.attributeCount).toBe(5);
  });

  it("lists attribute names at summary depth", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDescribeEntity(graph, "alm_organization", "summary", schemaPath);
    expect(result.attributes.some((a) => a.name === "alm_name")).toBe(true);
    expect(result.attributes.some((a) => a.name === "alm_orgcode")).toBe(true);
    expect(result.attributes[0].type).toBeUndefined();
  });

  it("includes attribute type details at full depth", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDescribeEntity(graph, "alm_organization", "full", schemaPath);
    const nameAttr = result.attributes.find((a) => a.name === "alm_name");
    expect(nameAttr).toBeDefined();
    expect(nameAttr!.type).toBe("String");
    expect(nameAttr!.requiredLevel).toBe("Required");
    expect(nameAttr!.isValidForCreate).toBe(true);
  });

  it("lists consumer activities", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDescribeEntity(graph, "alm_organization", "summary", schemaPath);
    expect(result.consumers.length).toBeGreaterThan(0);
  });

  it("returns error for unknown entity", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDescribeEntity(graph, "nonexistent_entity", "summary", schemaPath);
    expect(result.error).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/describeEntity.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement handleDescribeEntity**

Create `src/tools/describeEntity.ts`:

```typescript
import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { loadEntityDetail } from "../parsers/dataverseSchema.js";

interface AttributeSummary {
  name: string;
  type?: string;
  requiredLevel?: string;
  isValidForCreate?: boolean;
  isValidForUpdate?: boolean;
  displayName?: string;
  isCustomAttribute?: boolean;
}

interface Consumer {
  activityId: string;
  activityName: string;
  direction: "reads" | "writes";
}

export interface DescribeEntityResult {
  entity: string;
  displayName?: string;
  entitySetName?: string;
  primaryId?: string;
  primaryName?: string;
  attributeCount?: number;
  consumers: Consumer[];
  attributes: AttributeSummary[];
  error?: string;
}

export function handleDescribeEntity(
  graph: Graph,
  entity: string,
  depth: "summary" | "full",
  schemaPath?: string,
): DescribeEntityResult {
  const nodeId = `${NodeType.DataverseEntity}:${entity}`;
  const node = graph.getNode(nodeId);

  if (!node) {
    return {
      entity,
      consumers: [],
      attributes: [],
      error: `Entity '${entity}' not found in graph`,
    };
  }

  const consumers: Consumer[] = [];
  const incoming = graph.getIncoming(nodeId);
  for (const edge of incoming) {
    if (edge.type === EdgeType.ReadsFrom || edge.type === EdgeType.WritesTo) {
      const actNode = graph.getNode(edge.from);
      consumers.push({
        activityId: edge.from,
        activityName: actNode?.name ?? edge.from,
        direction: edge.type === EdgeType.ReadsFrom ? "reads" : "writes",
      });
    }
  }

  const attrEdges = graph.getOutgoing(nodeId).filter((e) => e.type === EdgeType.HasAttribute);
  let attributes: AttributeSummary[] = attrEdges.map((e) => {
    const attrNode = graph.getNode(e.to);
    const attrName = attrNode?.name.split(".").pop() ?? e.to;
    return { name: attrName };
  });

  if (depth === "full" && schemaPath && node.metadata.schemaFile) {
    const detail = loadEntityDetail(schemaPath, node.metadata.schemaFile as string);
    if (detail) {
      attributes = detail.attributes.map((a) => ({
        name: a.logicalName,
        type: a.attributeType,
        requiredLevel: a.requiredLevel,
        isValidForCreate: a.isValidForCreate,
        isValidForUpdate: a.isValidForUpdate,
        displayName: a.displayName,
        isCustomAttribute: a.isCustomAttribute,
      }));
    }
  }

  return {
    entity,
    displayName: node.metadata.displayName as string | undefined,
    entitySetName: node.metadata.entitySetName as string | undefined,
    primaryId: node.metadata.primaryId as string | undefined,
    primaryName: node.metadata.primaryName as string | undefined,
    attributeCount: node.metadata.attributeCount as number | undefined,
    consumers,
    attributes,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/describeEntity.test.ts`
Expected: PASS

- [ ] **Step 5: Register tool in server.ts**

In `src/server.ts`, add import:

```typescript
import { handleDescribeEntity } from "./tools/describeEntity.js";
```

Add tool registration (after `graph_describe_pipeline`):

```typescript
server.tool(
  "graph_describe_entity",
  "Describe a Dataverse entity: metadata, attributes, and pipeline consumers. At 'full' depth, includes attribute types, required levels, and create/update flags from the schema file.",
  {
    entity: z.string().describe("Dataverse entity logical name (e.g. 'alm_organization')"),
    depth: z
      .enum(["summary", "full"])
      .default("summary")
      .describe("'summary' = names only; 'full' = attribute types, required levels, create/update flags"),
    environment: environmentParam,
  },
  async ({ entity, depth, environment }) => {
    const build = manager.ensureGraph(environment);
    const envName = environment ?? manager.getDefaultEnvironment();
    const schemaPath = manager.getSchemaPath(envName);
    const result = handleDescribeEntity(build.graph, entity, depth, schemaPath);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);
```

Add `getSchemaPath` method to `GraphManager`:

```typescript
getSchemaPath(envName: string): string | undefined {
  return this.resolveSchemaPath(envName);
}
```

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/tools/describeEntity.ts tests/tools/describeEntity.test.ts src/server.ts src/graph/manager.ts
git commit -m "feat: add graph_describe_entity tool for Dataverse entity exploration"
```

---

### Task 8: Enhanced Lineage — Attribute-Level Tracing

**Files:**
- Modify: `src/tools/lineage.ts`
- Modify: `tests/tools/lineage.test.ts`

- [ ] **Step 1: Write failing tests for attribute-level lineage**

In `tests/tools/lineage.test.ts`, add:

```typescript
const schemaPath = join(import.meta.dirname, "../fixtures/dataverse-schema/test-env");

describe("lineage with schema data", () => {
  it("traces downstream from staging table through to dataverse attributes", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDataLineage(graph, "dbo.Org_Staging", undefined, "downstream");
    const nodeIds = result.paths.flatMap((p) => p.steps.map((s) => s.nodeId));
    expect(nodeIds.some((id) => id.startsWith("dataverse_attribute:"))).toBe(true);
  });

  it("matches attribute parameter against DataverseAttribute nodes", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDataLineage(graph, "alm_organization", "alm_name", "upstream");
    expect(result.columnMappings.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/lineage.test.ts`
Expected: FAIL — downstream doesn't reach attribute nodes

- [ ] **Step 3: Update lineage to traverse HasAttribute edges and match attribute nodes**

In `src/tools/lineage.ts`, the downstream traversal already follows all outgoing edges via `traverseDownstream`, which will naturally follow `HasAttribute` edges from entity nodes to attribute nodes. The key change is in the column mapping logic — when matching `attribute` against `MapsColumn` sink columns, also check if there's a corresponding `DataverseAttribute` node:

Update the column mapping section to also search for attribute nodes by ID pattern:

```typescript
// After existing column mapping collection, add attribute-aware matching:
if (attribute !== undefined) {
  // Check if the attribute matches a DataverseAttribute node directly
  const entityName = node?.type === NodeType.DataverseEntity ? node.name : entity;
  const attrNodeId = `${NodeType.DataverseAttribute}:${entityName}.${attribute}`;
  const attrNode = graph.getNode(attrNodeId);
  if (attrNode) {
    // Find MapsColumn edges where sinkColumn matches this attribute name
    for (const actId of allActivityIds) {
      const outgoing = graph.getOutgoing(actId);
      for (const edge of outgoing) {
        if (edge.type !== EdgeType.MapsColumn) continue;
        const sinkColumn = (edge.metadata.sinkColumn as string | null) ?? null;
        const sourceColumn = (edge.metadata.sourceColumn as string | null) ?? null;
        if (sinkColumn === attribute || sourceColumn === attribute) {
          const alreadyAdded = columnMappings.some(
            (m) => m.activityId === actId && m.sourceColumn === sourceColumn && m.sinkColumn === sinkColumn,
          );
          if (!alreadyAdded) {
            columnMappings.push({ activityId: actId, sourceColumn, sinkColumn });
          }
        }
      }
    }
  }
}
```

The exact implementation will depend on verifying against the fixture data — the existing tests should continue to pass since the behavior is additive.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/lineage.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/lineage.ts tests/tools/lineage.test.ts
git commit -m "feat: extend data lineage to traverse through Dataverse attributes"
```

---

### Task 9: Enhanced Validate — Schema Validation Rules

**Files:**
- Modify: `src/tools/validate.ts`
- Modify: `tests/tools/validate.test.ts`

- [ ] **Step 1: Write failing tests for schema validation rules**

In `tests/tools/validate.test.ts`, add:

```typescript
import { clearEntityDetailCache } from "../../src/parsers/dataverseSchema.js";

const schemaPath = join(import.meta.dirname, "../fixtures/dataverse-schema/test-env");

describe("schema validation rules", () => {
  beforeEach(() => {
    clearEntityDetailCache();
  });

  it("flags stub dataverse entities as warnings when schema is present", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    // Add a stub entity that's not in the schema
    graph.addNode({
      id: "dataverse_entity:fake_entity",
      type: NodeType.DataverseEntity,
      name: "fake_entity",
      metadata: { stub: true },
    });
    graph.addEdge({
      from: "activity:Test/FakeActivity",
      to: "dataverse_entity:fake_entity",
      type: EdgeType.WritesTo,
      metadata: {},
    });
    const result = handleValidate(graph, "test", "all", schemaPath);
    const stubEntities = result.issues.filter(
      (i) => i.category === "stub_dataverse_entity",
    );
    expect(stubEntities.length).toBeGreaterThanOrEqual(1);
    expect(stubEntities[0].severity).toBe("warning");
  });

  it("flags Copy activity mapping to nonexistent attribute", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    graph.addEdge({
      from: "activity:Test/CopyAct",
      to: "activity:Test/CopyAct",
      type: EdgeType.MapsColumn,
      metadata: { sinkColumn: "nonexistent_attr", sourceColumn: "src_col" },
    });
    graph.addEdge({
      from: "activity:Test/CopyAct",
      to: "dataverse_entity:alm_organization",
      type: EdgeType.WritesTo,
      metadata: {},
    });
    const result = handleValidate(graph, "test", "all", schemaPath);
    const missingAttr = result.issues.filter(
      (i) => i.category === "missing_dataverse_attribute",
    );
    expect(missingAttr.length).toBeGreaterThanOrEqual(1);
    expect(missingAttr[0].severity).toBe("error");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/validate.test.ts`
Expected: FAIL — handleValidate doesn't accept schemaPath

- [ ] **Step 3: Update handleValidate to add schema rules**

In `src/tools/validate.ts`, update the signature:

```typescript
export function handleValidate(
  graph: Graph,
  environment: string,
  severity: "all" | "error" | "warning",
  schemaPath?: string,
): GraphValidationResult {
```

Add import:

```typescript
import { loadEntityDetail } from "../parsers/dataverseSchema.js";
```

After the existing warning checks, add schema validation:

```typescript
  // ── Dataverse schema validation ─────────────────────────────────────────
  if (schemaPath) {
    const dvEntities = graph.getNodesByType(NodeType.DataverseEntity);

    for (const entity of dvEntities) {
      if (isStub(entity)) {
        issues.push({
          severity: "warning",
          category: "stub_dataverse_entity",
          message: `Dataverse entity '${entity.name}' is referenced but has no schema definition`,
          nodeId: entity.id,
        });
      }
    }

    // Check Copy activity MapsColumn sinks against schema attributes
    for (const node of graph.allNodes()) {
      if (node.type !== NodeType.Activity) continue;

      const outgoing = graph.getOutgoing(node.id);
      const writesToEntities = outgoing
        .filter((e) => e.type === EdgeType.WritesTo && e.to.startsWith("dataverse_entity:"))
        .map((e) => e.to.replace("dataverse_entity:", ""));
      if (writesToEntities.length === 0) continue;

      const mapColumnEdges = outgoing.filter((e) => e.type === EdgeType.MapsColumn);
      for (const edge of mapColumnEdges) {
        const sinkCol = edge.metadata.sinkColumn as string | undefined;
        if (!sinkCol) continue;

        for (const entityName of writesToEntities) {
          const attrNodeId = `dataverse_attribute:${entityName}.${sinkCol}`;
          if (!graph.getNode(attrNodeId)) {
            issues.push({
              severity: "error",
              category: "missing_dataverse_attribute",
              message: `Activity '${node.name}' maps to attribute '${sinkCol}' on entity '${entityName}', but that attribute does not exist in the schema`,
              nodeId: node.id,
              relatedNodeId: `dataverse_entity:${entityName}`,
            });
          }
        }
      }
    }
  }
```

- [ ] **Step 4: Update server.ts to pass schemaPath to validate**

In `src/server.ts`, update the validate tool call:

```typescript
async ({ environment, severity }) => {
  const build = manager.ensureGraph(environment);
  const envName = environment ?? manager.getDefaultEnvironment();
  const schemaPath = manager.getSchemaPath(envName);
  const result = handleValidate(build.graph, envName, severity, schemaPath);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
},
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/tools/validate.test.ts`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/tools/validate.ts tests/tools/validate.test.ts src/server.ts
git commit -m "feat: add Dataverse schema validation rules to graph_validate"
```

---

### Task 10: Enhanced Deploy Readiness — Schema Validation Section

**Files:**
- Modify: `src/tools/deployReadiness.ts`
- Modify: `tests/tools/deployReadiness.test.ts`

- [ ] **Step 1: Write failing tests for dataverseSchemaValidation**

In `tests/tools/deployReadiness.test.ts`, add:

```typescript
const schemaPath = join(import.meta.dirname, "../fixtures/dataverse-schema/test-env");

describe("deploy readiness with schema", () => {
  it("includes dataverseSchemaValidation section when schemaPath is provided", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDeployReadiness(graph, "Test_Orchestrator", undefined, undefined, schemaPath);
    expect(result.dataverseSchemaValidation).toBeDefined();
    expect(result.dataverseSchemaValidation!.validated).toBe(true);
  });

  it("reports entity matches for entities in the schema", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleDeployReadiness(graph, "Copy_To_Dataverse", undefined, undefined, schemaPath);
    expect(result.dataverseSchemaValidation!.entityMatches).toBeGreaterThanOrEqual(1);
  });

  it("omits dataverseSchemaValidation when no schemaPath", () => {
    const { graph } = buildGraph(fixtureRoot);
    const result = handleDeployReadiness(graph, "Test_Orchestrator");
    expect(result.dataverseSchemaValidation).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/deployReadiness.test.ts`
Expected: FAIL — handleDeployReadiness doesn't accept schemaPath

- [ ] **Step 3: Update handleDeployReadiness**

In `src/tools/deployReadiness.ts`, update the signature:

```typescript
export function handleDeployReadiness(
  graph: Graph,
  pipeline: string,
  compareGraph?: Graph,
  compareEnv?: string,
  schemaPath?: string,
): DeployReadinessResult {
```

Add to the `DeployReadinessResult` interface:

```typescript
dataverseSchemaValidation?: {
  validated: boolean;
  entityMatches: number;
  entityMisses: string[];
  attributeWarnings: Array<{
    entity: string;
    attribute: string;
    issue: "not_found" | "read_only" | "missing_required";
  }>;
};
```

Before the return statement, add schema validation:

```typescript
  let dataverseSchemaValidation: DeployReadinessResult["dataverseSchemaValidation"];
  if (schemaPath) {
    const dvDeps = dependencies.dataverseEntities;
    const entityMatches = dvDeps.filter((d) => d.status === "present").length;
    const entityMisses = dvDeps.filter((d) => d.status !== "present").map((d) => d.name);

    dataverseSchemaValidation = {
      validated: true,
      entityMatches,
      entityMisses,
      attributeWarnings: [],
    };
  }
```

Include it in the return:

```typescript
  return {
    pipeline,
    ready: !hasStubOrMissing && parameterIssues.length === 0,
    dependencies,
    parameterIssues,
    linkedServiceIssues,
    warnings,
    ...(dataverseSchemaValidation ? { dataverseSchemaValidation } : {}),
  };
```

Update `src/server.ts` deploy readiness tool call to pass schemaPath:

```typescript
async ({ pipeline, environment, compare_env }) => {
  const build = manager.ensureGraph(environment);
  const envName = environment ?? manager.getDefaultEnvironment();
  const schemaPath = manager.getSchemaPath(envName);
  const compareResult = compare_env ? manager.ensureGraph(compare_env) : undefined;
  const result = handleDeployReadiness(build.graph, pipeline, compareResult?.graph, compare_env, schemaPath);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/deployReadiness.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/deployReadiness.ts tests/tools/deployReadiness.test.ts src/server.ts
git commit -m "feat: add Dataverse schema validation to deploy readiness checks"
```

---

### Task 11: Enhanced Search — Entity and Attribute Search

**Files:**
- Modify: `src/tools/enhancedSearch.ts`
- Modify: `tests/tools/enhancedSearch.test.ts`

- [ ] **Step 1: Write failing tests for entity/attribute search**

In `tests/tools/enhancedSearch.test.ts`, add:

```typescript
const schemaPath = join(import.meta.dirname, "../fixtures/dataverse-schema/test-env");

describe("search with schema data", () => {
  it("finds DataverseEntity nodes by name", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleEnhancedSearch(graph, "alm_organization", {});
    expect(result.hits.some((h) => h.nodeType === "dataverse_entity")).toBe(true);
  });

  it("finds DataverseEntity nodes by displayName metadata", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleEnhancedSearch(graph, "Organization", {});
    expect(result.hits.some((h) => h.nodeType === "dataverse_entity" && h.name === "alm_organization")).toBe(true);
  });

  it("finds DataverseAttribute nodes by name", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleEnhancedSearch(graph, "alm_orgcode", {});
    expect(result.hits.some((h) => h.nodeType === "dataverse_attribute")).toBe(true);
  });

  it("filters by nodeType dataverse_entity", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleEnhancedSearch(graph, "alm_", { nodeType: "dataverse_entity" });
    expect(result.hits.every((h) => h.nodeType === "dataverse_entity")).toBe(true);
  });

  it("filters by nodeType dataverse_attribute", () => {
    const { graph } = buildGraph(fixtureRoot, schemaPath);
    const result = handleEnhancedSearch(graph, "alm_", { nodeType: "dataverse_attribute" });
    expect(result.hits.every((h) => h.nodeType === "dataverse_attribute")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/tools/enhancedSearch.test.ts`
Expected: FAIL — entity/attribute nodes not searched with displayName

- [ ] **Step 3: Update enhancedSearch to search entity metadata**

In `src/tools/enhancedSearch.ts`, add entity metadata searching. After the node name match block, before the `if (!matchedField) continue;` line, add:

```typescript
    // For DataverseEntity nodes, also search displayName and entitySetName
    if (!matchedField && node.type === NodeType.DataverseEntity) {
      const displayName = node.metadata.displayName as string | undefined;
      const entitySetName = node.metadata.entitySetName as string | undefined;
      if (displayName && displayName.toLowerCase().includes(lowerQuery)) {
        matchedField = "displayName";
        matchedText = displayName;
      } else if (entitySetName && entitySetName.toLowerCase().includes(lowerQuery)) {
        matchedField = "entitySetName";
        matchedText = entitySetName;
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/tools/enhancedSearch.test.ts`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/tools/enhancedSearch.ts tests/tools/enhancedSearch.test.ts
git commit -m "feat: extend search to include Dataverse entity and attribute nodes"
```

---

### Task 12: Update Server — Add Environment schemaPath and Find Consumers

**Files:**
- Modify: `src/server.ts`
- Modify: `src/tools/addEnvironment.ts`

- [ ] **Step 1: Update graph_add_environment to accept schemaPath**

In `src/server.ts`, update the `graph_add_environment` tool schema:

```typescript
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
    schemaPath: z
      .string()
      .optional()
      .describe("Optional path to Dataverse schema environment directory (contains per-entity JSON files)"),
  },
  async ({ name, path, overlays, schemaPath }) => {
    const result = handleAddEnvironment(manager, name, path, overlays, schemaPath);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);
```

Update `src/tools/addEnvironment.ts`:

```typescript
export function handleAddEnvironment(
  manager: GraphManager,
  name: string,
  path: string,
  overlays?: string[],
  schemaPath?: string,
): AddEnvironmentResult {
  manager.addEnvironment(name, path, overlays, schemaPath);
  return { added: true, name, path };
}
```

- [ ] **Step 2: Update graph_find_consumers to include dataverse_attribute in target_type enum**

In `src/server.ts`, update the `target_type` enum for `graph_find_consumers` and `graph_impact_analysis`:

```typescript
target_type: z
  .enum(["pipeline", "activity", "dataset", "stored_procedure", "table", "dataverse_entity", "dataverse_attribute", "linked_service", "key_vault_secret"])
  .describe("Node type of the target"),
```

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 4: Commit**

```bash
git add src/server.ts src/tools/addEnvironment.ts
git commit -m "feat: add schemaPath to runtime environment registration and dataverse_attribute to target types"
```

---

### Task 13: Version Bump and Manifest Update

**Files:**
- Modify: `package.json`
- Modify: `server.json`
- Modify: `src/server.ts:32-34`

- [ ] **Step 1: Bump version in package.json**

Change `"version": "0.9.3"` to `"version": "0.10.0"` in `package.json`.

- [ ] **Step 2: Bump version in server.json**

Change all three `"version": "0.9.3"` occurrences to `"0.10.0"` in `server.json`.

Add `graph_describe_entity` to the tools list:

```json
{ "name": "graph_describe_entity", "description": "Describe a Dataverse entity: metadata, attributes, pipeline consumers. Full depth includes types and required levels from schema." }
```

- [ ] **Step 3: Bump version in src/server.ts**

Change `version: "0.9.3"` to `version: "0.10.0"` in the McpServer constructor.

- [ ] **Step 4: Run full test suite**

Run: `npx vitest run`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add package.json server.json src/server.ts
git commit -m "chore: bump version to 0.10.0 for Dataverse schema integration"
```

---

### Task 14: Build, Test, and Publish

- [ ] **Step 1: Full build**

Run: `npm run build`
Expected: Clean compile with no errors

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: All tests PASS

- [ ] **Step 3: Publish to npm**

Run: `npm publish --access public`
Expected: Package published as `adf-graph@0.10.0`

- [ ] **Step 4: Verify published package**

Run: `npm info adf-graph version`
Expected: `0.10.0`

- [ ] **Step 5: Commit any remaining changes**

If the build produced any unexpected changes, commit them:

```bash
git status
```
