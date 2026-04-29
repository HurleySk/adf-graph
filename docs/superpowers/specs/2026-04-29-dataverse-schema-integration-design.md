# Dataverse Schema Integration

Incorporate Dataverse entity metadata into the adf-graph dependency graph, enabling end-to-end column-level lineage from SQL staging tables through Copy activities to individual Dataverse attributes, schema-aware validation, and entity exploration.

## Motivation

Today adf-graph knows that a pipeline writes to `alm_fercorganization` but nothing about that entity's attributes. The lineage chain stops at the entity boundary. Meanwhile, the boomerang project already exports rich entity metadata (`dataverse-schema/`) with 1,200+ entities per environment. Bridging this gap enables:

- Tracing a column from source SQL all the way to a specific Dataverse attribute
- Validating Copy activity mappings against the actual schema before deployment
- Exploring entity schemas directly from the graph

## Data Source

The schema comes from exported JSON files produced by boomerang's CLI (`DataverseSchemaPull`). Two file types:

- **`_index.json`** — single file per environment directory. Contains all 1,200+ entities with: logicalName, displayName, entitySetName, primaryId, primaryName, attributeCount, file reference, and comma-separated attribute list. ~1.3 MB.
- **Per-entity JSON files** (e.g., `alm_fercorganization.json`) — full Dataverse metadata API response per entity. Contains detailed attribute metadata: AttributeType, RequiredLevel, IsValidForCreate/Update, DisplayName, IsCustomAttribute, and more. Files range from 2K to 30K+ lines.

No live API calls. The MCP server reads these files from disk — the user runs the CLI to refresh them.

## Config

Add optional `schemaPath` to `EnvironmentConfig`:

```json
{
  "environments": {
    "work-repo": {
      "path": "C:/repos/work-repo",
      "schemaPath": "C:/repos/boomerang/dataverse-schema/almwave3",
      "default": true
    },
    "qa": {
      "path": "C:/exports/qa",
      "schemaPath": "C:/repos/boomerang/dataverse-schema/almqa"
    }
  }
}
```

- `schemaPath` points to a specific environment subdirectory containing entity JSON files and inheriting from the parent `_index.json`
- Optional — environments without `schemaPath` behave exactly as before
- Validated as a non-empty string if present; no existence check at config load time
- Runtime environments (`graph_add_environment`) also accept optional `schemaPath`

### Index location

The `_index.json` file lives in the parent directory of the per-environment subdirectory (e.g., `dataverse-schema/_index.json`). The parser resolves it by looking at `join(schemaPath, "..", "_index.json")`. If the index is not found, emit a warning and skip schema parsing.

## Data Model

### New node type

```typescript
DataverseAttribute = "dataverse_attribute"
```

### New edge type

```typescript
HasAttribute = "has_attribute"  // DataverseEntity → DataverseAttribute
```

### Node ID scheme

| Type | Pattern | Example |
|------|---------|---------|
| Entity | `dataverse_entity:{logicalName}` | `dataverse_entity:alm_fercorganization` |
| Attribute | `dataverse_attribute:{entity}.{attribute}` | `dataverse_attribute:alm_fercorganization.alm_name` |

### Entity node metadata (from index)

```typescript
{
  displayName: string;
  entitySetName: string;
  primaryId: string;
  primaryName: string;
  attributeCount: number;
  schemaFile: string;       // filename for lazy loading (e.g., "alm_fercorganization.json")
}
```

### Attribute node metadata

At build time (from index): minimal — just `entityLogicalName`.

After lazy enrichment (from per-entity file):

```typescript
{
  entityLogicalName: string;
  attributeType?: string;       // "String", "Lookup", "Picklist", etc.
  requiredLevel?: string;       // "None", "Required", "Recommended"
  isValidForCreate?: boolean;
  isValidForUpdate?: boolean;
  displayName?: string;
  isCustomAttribute?: boolean;
}
```

## Parser

New file: `src/parsers/dataverseSchema.ts`

### `parseSchemaIndex(schemaPath: string): SchemaParseResult`

1. Reads `_index.json` from the parent of `schemaPath`
2. Filters entities to only those with per-entity files in the `schemaPath` directory (environment-specific subset)
3. For each entity:
   - Creates a `DataverseEntity` node with index metadata
   - Splits comma-separated `attributes` string, trims whitespace
   - Creates a `DataverseAttribute` node per attribute
   - Creates a `HasAttribute` edge from entity to attribute
4. Returns `{ nodes, edges, warnings, entityCount }`

### `loadEntityDetail(schemaPath: string, schemaFile: string): EntityDetail | null`

Lazy loader for per-entity files. Called by tools that need deep attribute metadata.

1. Reads `join(schemaPath, schemaFile)`
2. Extracts from the `Attributes` array: LogicalName, AttributeType, RequiredLevel.Value, IsValidForCreate, IsValidForUpdate, DisplayName label, IsCustomAttribute
3. Returns structured array of attribute details, or null if file not found

Results should be cached in-memory (keyed by `schemaPath + schemaFile`) to avoid repeated file reads within a session. Cache is invalidated on graph rebuild.

## Builder

### New Pass 5: Dataverse Schema

Inserted after Pass 4b (SP column mappings) and before the stub pass (which becomes Pass 6):

```typescript
// ── Pass 5: Dataverse Schema ──────────────────────────────────────────
if (schemaPath) {
  const schemaResult = parseSchemaIndex(schemaPath);
  warnings.push(...schemaResult.warnings);
  merge(graph, schemaResult);
}
```

### Signature change

```typescript
export function buildGraph(rootPath: string, schemaPath?: string): BuildResult
```

### Merge behavior

When a Copy activity in Pass 1 already created a stub `dataverse_entity:alm_foo` node, the schema pass replaces it with a fully populated node. The existing `merge()` function adds nodes only if not already present — so the schema parser should use `graph.replaceNode()` for entities that already exist as stubs, or the merge function should be updated to allow real nodes to replace stubs (consistent with overlay merge behavior).

## Staleness

Track `_index.json` mtime separately from the standard `StalenessChecker`. The schema directory should NOT be added to the recursive `StalenessChecker` because:

- Per-entity files are lazy-loaded and shouldn't trigger rebuilds
- The schema directory may contain subdirectories for other environments

Instead, the manager tracks `_index.json` mtime directly:

```typescript
private schemaIndexMtime: Map<string, number>; // envName → last built mtime

private isSchemaStale(envName: string, schemaPath: string): boolean {
  const indexPath = join(schemaPath, "..", "_index.json");
  if (!existsSync(indexPath)) return false;
  const mtime = statSync(indexPath).mtimeMs;
  const lastBuilt = this.schemaIndexMtime.get(envName);
  return lastBuilt === undefined || mtime > lastBuilt;
}
```

A rebuild is triggered if either the ADF artifacts OR the schema index is stale.

## Tools

### New: `graph_describe_entity`

**Input**: `entity` (string), `depth` ("summary" | "full", default "summary"), `environment` (optional)

**Summary output**:
- Entity metadata: displayName, entitySetName, primaryId, primaryName, attributeCount
- Consumer list: activities that read/write to this entity (from graph edges)
- Attribute names (from graph nodes)

**Full output** (adds lazy-loaded detail):
- Per-attribute: type, requiredLevel, isValidForCreate/Update, displayName, isCustomAttribute
- Column mappings from Copy activities that target this entity

### Enhanced: `graph_data_lineage`

- Downstream traversal now extends through `HasAttribute` edges to individual attribute nodes
- The `attribute` parameter matches against `DataverseAttribute` node names, enabling queries like "trace lineage for `alm_fercorganization.alm_name`"
- Column mappings from Copy activities are cross-referenced with attribute nodes: if a Copy has `MapsColumn` with `sinkColumn: "alm_name"` and the graph has `dataverse_attribute:alm_fercorganization.alm_name`, the lineage result connects them

### Enhanced: `graph_validate`

New validation rules when schema data is present:

| Rule | Severity | Requires lazy load |
|------|----------|-------------------|
| Copy activity maps to attribute not in schema | error | no |
| Copy writes to read-only attribute | warning | yes |
| Required attributes with no Copy mapping | warning | yes |
| Pipeline references entity not in schema (remains stub) | warning | no |

### Enhanced: `graph_deploy_readiness`

New `dataverseSchemaValidation` section:

```typescript
{
  validated: boolean;           // false if no schemaPath configured
  entityMatches: number;        // entities referenced by pipelines that have schema
  entityMisses: string[];       // entities referenced but not in schema
  attributeWarnings: Array<{
    entity: string;
    attribute: string;
    issue: "not_found" | "read_only" | "missing_required";
  }>;
}
```

### Enhanced: `graph_search`

- Search type `"dataverse_entity"`: matches against entity logicalName, displayName, entitySetName
- Search type `"dataverse_attribute"`: matches attribute names across all entities
- Free-text search includes entity/attribute node names (automatic — existing implementation iterates all nodes)

### `graph_stats`

No code change needed. The existing `stats()` method iterates all nodes/edges by type, so `dataverse_entity`, `dataverse_attribute`, and `has_attribute` counts appear automatically.

## Non-Goals

- **Schema overlays**: Schema is not overlayable. The merged `{name}+overlays` view inherits the base environment's schema. Overlays are for ADF artifacts, not external metadata.
- **Entity relationships**: Lookup relationships between entities are deferred. Attribute metadata includes lookup targets, but modeling them as graph edges is a future enhancement.
- **Live API integration**: No Dataverse API calls. Schema data comes from pre-exported files.
- **Cross-environment schema diff**: Comparing entity schemas across environments is potentially useful but deferred. The graph already has `graph_diff_environments` for ADF artifacts.

## Publishing

After implementation is complete and tests pass:

1. Bump `version` in both `package.json` and `server.json` (they must match)
2. `npm run build`
3. `npm test`
4. `npm publish --access public`
