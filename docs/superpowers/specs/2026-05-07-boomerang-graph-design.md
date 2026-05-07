# boomerang-graph Design Spec

**Date:** 2026-05-07
**Status:** Approved (design phase)

## Problem

Agents working in the boomerang ecosystem constantly grep and search files to understand SQL objects and Dataverse entities. adf-graph provides the relationship spine — it knows which pipelines call which stored procedures, write to which tables, target which entities — but when agents need depth (SP bodies, table schemas, entity attributes, FK relationships, SP call chains), they leave the graph and grep through `db-export/` and `dataverse-schema/`. That's where the tokens go.

## Solution

A new MCP server — **boomerang-graph** — that deeply indexes SQL database objects and Dataverse entity metadata, building an internal dependency graph for each domain. It serves as the deep knowledge layer that agents query when they follow an adf-graph edge and need substance.

Cross-references between adf-graph and boomerang-graph are bidirectional, structured, and machine-readable — agents follow them without grepping.

## Architecture

Three independent MCP servers, each focused on its domain:

| Server | Domain | Tools | Data Sources |
|--------|--------|-------|-------------|
| **adf-graph** | ADF pipeline relationships | ~50 | `work-repo/`, `adf-export/` |
| **boomerang-graph** (new) | Deep SQL & Dataverse | ~16 | `db-export/`, `dataverse-schema/` |
| **code-graph** | C# code via Roslyn | 8 | `Boomerang.sln` |

### Design Principles

- **No runtime coupling.** Servers don't call each other. Cross-references are name-based hints embedded in JSON responses.
- **adf-graph is the relationship spine.** boomerang-graph provides depth, not new relationship discovery.
- **Identical infrastructure patterns.** Same tech stack, graph model shape, staleness tracking, config pattern, and tool registration approach as adf-graph.
- **Lazy deep parsing.** Index scans run eagerly; expensive file-by-file parsing only triggers when a tool needs it.

## Data Sources

### SQL Objects — `db-export/{env}/{type}/{schema}.{name}.sql`

Organization: environment → object type → DDL file.

| Environment | Procedures | Tables | Functions | Views | Total |
|-------------|-----------|--------|-----------|-------|-------|
| devqa | 152 | 777 | 8 | 1 | 938 |
| w3preprd | 146 | 757 | 5 | 1 | 909 |
| dev | 3 | 2 | — | — | 5 |
| ferconlineprod | — | 530 | — | — | 530 |
| prd | 1 | — | — | — | 1 |
| qa | 1 | — | — | — | 1 |

Each environment has an `_index.json` manifest with table/column metadata, object counts, and file references.

**File format:** Each `.sql` file contains a single `CREATE` statement (CREATE TABLE, CREATE PROCEDURE, CREATE VIEW, CREATE FUNCTION).

### Dataverse Entities — `dataverse-schema/{env}/{entity}.json`

Organization: environment → per-entity JSON files.

| Environment | Entities |
|-------------|----------|
| almwave3 | 1,225 |
| almwave3testpreprod | 1,217 |
| training | 1,215 |
| FOUNDATION | 1,212 |
| datadevqa | 1,210 |
| almuat | 2 |
| w3testpreprd | 2 |

Each environment has an `_index.json` manifest with entity names, attribute counts, and summary metadata.

**Entity JSON format:** Mirrors the Dataverse OData metadata API response. Each entity file contains:
- Entity metadata (logical name, schema name, display name, entity set name, primary ID/name attributes)
- Full attribute list with per-attribute detail:
  - Type (Picklist, String, DateTime, Lookup, Boolean, Integer, etc.)
  - Display name and description (localized labels)
  - CRUD flags (IsValidForCreate, IsValidForRead, IsValidForUpdate)
  - Required level (None, SystemRequired, Recommended)
  - Security flags (CanBeSecuredForRead/Create/Update)
  - Type-specific metadata: Lookup targets, OptionSet values, string max length, DateTime format/behavior

## Graph Model

### Node Types

| Node Type | Source | Key Fields |
|-----------|--------|-----------|
| `SqlTable` | `db-export/{env}/table/` | name, schema, columns (from index), environment |
| `SqlProcedure` | `db-export/{env}/procedure/` | name, schema, parameters, body (lazy), environment |
| `SqlView` | `db-export/{env}/view/` | name, schema, referenced tables, environment |
| `SqlFunction` | `db-export/{env}/function/` | name, schema, return type, body (lazy), environment |
| `DvEntity` | `dataverse-schema/{env}/` | logicalName, displayName, primaryId, primaryName, attributeCount, environment |
| `DvAttribute` | `dataverse-schema/{env}/` (lazy) | logicalName, type, requiredLevel, CRUD flags, lookup targets, optionSet values |

### Edge Types

| Edge Type | From → To | Source |
|-----------|-----------|--------|
| `Calls` | SqlProcedure → SqlProcedure | EXEC/sp_executesql in SP body |
| `ReadsFrom` | SqlProcedure → SqlTable | FROM/JOIN in SP body |
| `WritesTo` | SqlProcedure → SqlTable | INSERT INTO/UPDATE/DELETE FROM in SP body |
| `References` | SqlProcedure → SqlTable | OBJECT_ID() in SP body |
| `CallsFunction` | SqlProcedure → SqlFunction | dbo.fn_xxx() calls in SP body |
| `ForeignKey` | SqlTable → SqlTable | FOREIGN KEY REFERENCES in DDL |
| `ViewReads` | SqlView → SqlTable | FROM/JOIN in view definition |
| `HasAttribute` | DvEntity → DvAttribute | Entity attribute list |
| `LookupTo` | DvEntity → DvEntity | Lookup attribute Targets array |

## Parser Design

### Build Passes

| Pass | Type | Eager/Lazy | What It Does |
|------|------|-----------|-------------|
| 1 | SQL Index Scan | Eager | Read `_index.json` per env. Create SqlTable, SqlProcedure, SqlView, SqlFunction nodes with column metadata from index. |
| 2 | SQL Body Analysis | Lazy | Parse SP/function `.sql` bodies. Extract EXEC calls → Calls edges. Extract FROM/JOIN/INSERT/UPDATE/DELETE → ReadsFrom/WritesTo edges. Extract OBJECT_ID → References edges. Extract function calls → CallsFunction edges. |
| 3 | Table DDL Analysis | Lazy | Parse table `.sql` DDL. Extract FOREIGN KEY REFERENCES → ForeignKey edges. Enrich column metadata beyond index (defaults, constraints). |
| 4 | View Analysis | Lazy | Parse view `.sql` definitions. Extract FROM/JOIN → ViewReads edges. |
| 5 | Dataverse Index Scan | Eager | Read `_index.json` per env. Create DvEntity nodes with attribute summaries. |
| 6 | Dataverse Deep Scan | Lazy | Parse per-entity `.json` files. Create DvAttribute nodes. Extract Lookup Targets → LookupTo edges. Store OptionSet values as attribute metadata. |

**Lazy triggering:** Passes 2-4 and 6 run on first call to a tool that needs their data (e.g., `bg_describe_sql_object` with `detail: "full"` triggers pass 2 for that SP; `bg_entity_relationships` triggers pass 6 for that entity's environment). Once a pass runs for an environment, results are cached until staleness invalidation.

### SQL Parsing Strategy

SQL body parsing uses regex patterns, not a full SQL parser. The SP bodies in `db-export/` follow consistent patterns:

- `EXEC\s+(\[?\w+\]?\.)?\[?(\w+)\]?` → SP-to-SP calls
- `FROM\s+(\[?\w+\]?\.)?\[?(\w+)\]?` → table reads (with JOIN variants)
- `INSERT\s+INTO\s+(\[?\w+\]?\.)?\[?(\w+)\]?` → table writes
- `UPDATE\s+(\[?\w+\]?\.)?\[?(\w+)\]?` → table writes
- `DELETE\s+FROM\s+(\[?\w+\]?\.)?\[?(\w+)\]?` → table writes
- `OBJECT_ID\s*\(\s*['"]([^'"]+)['"]\s*` → table references
- `(dbo\.fn_\w+)` → function calls
- `FOREIGN\s+KEY.*?REFERENCES\s+(\[?\w+\]?\.)?\[?(\w+)\]?` → FK relationships

Dynamic SQL (via `sp_executesql` with string concatenation) is common in these SPs. The parser handles the straightforward cases; dynamically-constructed table names are flagged as `dynamic_reference` rather than resolved.

## MCP Tools

### SQL Domain (6 tools)

**`bg_describe_sql_object`** — Deep describe for any SQL object.
- Input: `name` (string), `environment` (string), `detail` ("summary" | "full")
- Summary: name, type, schema, column list (tables) or parameter list (SPs), immediate dependencies
- Full: adds SP body, all edges (calls, reads, writes), FK relationships
- Cross-ref: includes `adf_context` with pre-built `graph_describe_stored_procedure` or `graph_describe_table` call

**`bg_sql_dependencies`** — Dependency graph traversal for a SQL object.
- Input: `name`, `environment`, `direction` ("upstream" | "downstream" | "both"), `depth` (number, default 3)
- Returns: dependency tree with edge types at each level

**`bg_sql_search`** — Search SQL objects by name, column, referenced table, or body content.
- Input: `query` (string), `environment`, `searchIn` ("name" | "columns" | "body" | "all")
- Returns: matches with relationship context (not just file paths)

**`bg_sql_impact`** — Blast radius if a SQL object changes.
- Input: `name`, `environment`, `depth`
- Returns: affected objects organized by depth level, with edge types explaining why each is affected

**`bg_sql_diff`** — Compare a SQL object across environments.
- Input: `name`, `envA`, `envB`
- Returns: column diffs (tables), body diffs (SPs), parameter diffs

**`bg_sp_body`** — Raw SQL body retrieval.
- Input: `name`, `environment`
- Returns: the CREATE PROCEDURE/FUNCTION statement verbatim

### Dataverse Domain (5 tools)

**`bg_describe_entity`** — Deep entity detail.
- Input: `entity` (logical name), `environment`, `detail` ("summary" | "attributes" | "full")
- Summary: display name, primary fields, attribute count, lookup count
- Attributes: full attribute list with types, required levels, CRUD flags
- Full: adds option set values, lookup targets, all metadata
- Cross-ref: includes `adf_context` with pre-built `graph_entity_coverage` and `graph_describe_entity` calls

**`bg_entity_relationships`** — Entity relationship web.
- Input: `entity`, `environment`, `direction` ("outgoing" | "incoming" | "both")
- Returns: lookup relationships — what this entity points to and what points to it, with attribute names and cardinality

**`bg_entity_search`** — Search entities by name, attribute name, type, or option set value.
- Input: `query`, `environment`, `searchIn` ("name" | "attributes" | "optionsets" | "all")
- Returns: matching entities with attribute context

**`bg_entity_diff`** — Compare an entity across environments.
- Input: `entity`, `envA`, `envB`
- Returns: added/removed/changed attributes, option set value diffs, type changes

**`bg_optionset_values`** — Option set lookup.
- Input: `entity`, `attribute`, `environment`
- Returns: numeric values with labels for a picklist attribute

### Cross-Cutting (5 tools)

**`bg_stats`** — Overview statistics.
- Input: `environment` (optional — all envs if omitted)
- Returns: SQL object counts by type, entity counts, edge counts, build time, staleness per domain

**`bg_search`** — Unified search across SQL and Dataverse.
- Input: `query`, `environment`, `domain` ("sql" | "dataverse" | "all")
- Returns: typed results with relationship context from both domains

**`bg_enrich`** — Batch metadata lookup for cross-reference enrichment.
- Input: `names` (string array), `environment`
- Returns: concise metadata for each name — auto-detects type (SP, table, entity) and returns key stats + immediate relationships. Designed to be called after an adf-graph query to "light up" referenced objects.

**`bg_list_environments`** — Environment listing with stats.
- Returns: configured environments with per-env SQL/Dataverse counts and staleness

**`bg_export`** — Full graph export as JSON.
- Input: `environment`
- Returns: complete node/edge data for visualization clients

## Cross-Reference Contract

### boomerang-graph → adf-graph

Every boomerang-graph tool response that describes a SQL object or Dataverse entity includes an `adf_context` field:

```json
{
  "result": { "...tool-specific data..." },
  "adf_context": {
    "see_also": [
      {
        "server": "adf-graph",
        "tool": "graph_describe_stored_procedure",
        "args": { "name": "p_Entity_Staging_Transform", "environment": "work-repo" },
        "reason": "Pipeline relationships for this SP"
      }
    ]
  }
}
```

### adf-graph → boomerang-graph

adf-graph tools that reference SPs, tables, or entities include a `see_also` field with a pre-built `bg_enrich` call:

```json
{
  "result": { "...tool-specific data..." },
  "see_also": [
    {
      "server": "boomerang-graph",
      "tool": "bg_enrich",
      "args": {
        "names": ["p_Entity_Staging_Transform", "StagingTable", "alm_entity"],
        "environment": "devqa"
      },
      "reason": "Deep SQL/Dataverse detail for referenced objects"
    }
  ]
}
```

### Affected adf-graph tools

These existing tools get the `see_also` field added:
- `graph_describe_pipeline`
- `graph_describe_stored_procedure`
- `graph_describe_table`
- `graph_describe_entity`
- `graph_data_lineage`
- `graph_impact_analysis`
- `graph_trace_connection`
- `graph_entity_coverage`

### Shared naming convention

- SQL objects: `{schema}.{name}` (e.g., `dbo.p_Entity_Staging_Transform`)
- Dataverse entities: `{logicalName}` (e.g., `alm_fercbusinessunit`)

Both servers use these as lookup keys. No ambiguity.

### Contract properties

- **Optional.** If boomerang-graph isn't running, adf-graph works exactly as before. `see_also` is informational.
- **Static.** No runtime calls between servers. Just structured suggestions in JSON responses.
- **Agent-guided.** A CLAUDE.md rule in boomerang reinforces the pattern: "After adf-graph describe/lineage/impact tools, check `see_also` and call `bg_enrich` if present."

## Configuration

### Config file: `boomerang-graph.json`

```json
{
  "environments": {
    "devqa": {
      "dbExportPath": "C:/repos/boomerang-/db-export/devqa",
      "schemaPath": "C:/repos/boomerang-/dataverse-schema/datadevqa",
      "default": true
    },
    "w3preprd": {
      "dbExportPath": "C:/repos/boomerang-/db-export/w3preprd",
      "schemaPath": "C:/repos/boomerang-/dataverse-schema/almwave3testpreprod"
    },
    "prod": {
      "dbExportPath": "C:/repos/boomerang-/db-export/ferconlineprod",
      "schemaPath": "C:/repos/boomerang-/dataverse-schema/FOUNDATION"
    }
  }
}
```

### Config resolution

1. `BOOMERANG_CONFIG` env var (explicit path)
2. `boomerang-graph.json` next to `dist/server.js`
3. Error with helpful message

### Environment mapping

SQL environments (`db-export/devqa`) and Dataverse environments (`dataverse-schema/datadevqa`) have different directory names. The config maps them together under a single logical environment name that agents use.

## Tech Stack

- **Language:** TypeScript
- **Runtime:** Node.js ≥ 18
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Validation:** Zod
- **Testing:** Vitest
- **Build:** tsc
- **Package:** npm (publishable as `@hurleysk/boomerang-graph` or similar)

Reuse patterns from adf-graph:
- Graph model (nodes, edges, adjacency lists, traversal utils)
- Staleness tracking (file mtime, rebuild-if-stale)
- Multi-environment manager (lazy build, per-env caching)
- Tool registration pattern (one file per tool in `src/tools/`)
- Config loader pattern

## Out of Scope (v1)

- `tasks/`, `modules/`, `mappings/`, `ado-export/`, `dataverse-queries/` indexing
- Full SQL AST parsing (regex is sufficient for the DDL patterns in db-export)
- Federation/router layer across servers
- UI integration (adf-graph-ui handles the visual side)
- Runtime coupling between servers
