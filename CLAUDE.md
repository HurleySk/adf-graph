# adf-graph

MCP server that builds a queryable dependency graph from ADF pipeline artifacts.

## Build & Test

- Build: `npm run build`
- Test: `npm test`
- Dev: `npm run dev` (watch mode)

## Architecture

- `src/config.ts` — Config loader (ADF_CONFIG / adf-graph.json / ADF_ROOT fallback)
- `src/graph/model.ts` — Graph data structure (nodes, edges, adjacency lists)
- `src/graph/builder.ts` — 8-pass graph builder (pipelines → datasets → linked services → triggers → IRs → LS→IR edges → SQL/SP → Dataverse schema → stubs)
- `src/graph/staleness.ts` — File mtime tracking, rebuild-if-stale (multi-path aware)
- `src/graph/overlay.ts` — Artifact type detection, overlay scanning (structured + loose), graph merge
- `src/graph/manager.ts` — Multi-environment graph manager (lazy build, per-env staleness, schema staleness, overlay merge views)
- `src/graph/nodeMetadata.ts` - Typed accessors for node/edge metadata (activity, table, SP, entity, linked service, column mapping); use these instead of `metadata.x as T` casts
- `src/graph/traversalUtils.ts` - Shared traversal helpers (contained activities, child pipeline calls)
- `src/parsers/` — One parser per artifact type (pipeline, dataset, sql, columns, dataverseSchema, trigger, integrationRuntime)
- `src/parsers/sqlLex.ts` - Shared SQL lexing (comment stripping, paren/CASE depth, top-level comma split, identifier unquoting); all SQL parsers build on it
- `src/tools/` — One file per MCP tool (describe, describeEntity, describeStoredProcedure, describeTable, describeTrigger, describeIntegrationRuntime, environmentConfig, spBody, lineage, search, diff, impact, consumers, paths, stats, validate, deployReadiness, overlay/env management)
- `src/tools/toolUtils.ts` - Shared tool helpers (`resolveNode` name matching, entity schema detail, dest_query target iteration)
- `src/registerTools.ts` - Tool registration via `tool()` / `envTool()`; `envTool` adds the `environment` param and resolves graph, schemaPath and see-also once. Handler exceptions (including unknown environments) return `{ error }` with `isError: true`
- `src/server.ts` — MCP server entry point

## Configuration

### Multi-environment (recommended)

Create `adf-graph.json` next to `dist/server.js` (or point `ADF_CONFIG` at any JSON file):

```json
{
  "environments": {
    "work-repo": {
      "path": "C:/path/to/work-repo",
      "default": true
    },
    "dev1": {
      "path": "C:/path/to/adf-export/dev1"
    }
  }
}
```

Or set `ADF_CONFIG=/absolute/path/to/adf-graph.json` to use a file at an arbitrary location.

### Single-environment (backward-compatible)

`ADF_ROOT` env var — path to a directory containing ADF artifacts (`pipeline/`, `dataset/`, etc.).
Behaves exactly as before; creates a single environment named `"default"`.

### Dataverse Schema

Environments can have an optional `schemaPath` to integrate Dataverse entity metadata into the graph:

```json
{
  "environments": {
    "work-repo": {
      "path": "C:/repos/work-repo",
      "default": true,
      "schemaPath": "C:/repos/boomerang/dataverse-schema/almwave3"
    }
  }
}
```

- `schemaPath` points to an environment subdirectory containing per-entity JSON files (exported by the CLI's `DataverseSchemaPull`).
- The `_index.json` in the parent directory is parsed at build time to create `DataverseEntity` and `DataverseAttribute` nodes with `HasAttribute` edges.
- Per-entity files are lazy-loaded when tools need deep attribute detail (types, required levels, create/update flags).
- Enables: `graph_describe_entity`, schema-aware validation, attribute-level lineage, and deploy-readiness schema checks.
- Schema data is NOT overlayable — merged views inherit the base environment's schema.

### Overlays

Environments can have an optional `overlays` array to layer local/in-progress files on top:

```json
{
  "environments": {
    "work-repo": {
      "path": "C:/repos/adf-main",
      "default": true,
      "overlays": ["C:/my-wip/", "C:/one-off/NewPipeline.json"]
    }
  }
}
```

- Overlay directories with ADF structure (`pipeline/`, `dataset/`) are parsed normally.
- Loose files are auto-detected by inspecting JSON content.
- The base graph stays clean; a merged view appears as `{name}+overlays`.
- Runtime overlays can be added/removed via MCP tools (`graph_add_overlay`, `graph_remove_overlay`).
- Runtime environments can be registered via `graph_add_environment`.
- Runtime additions are ephemeral (lost on server restart).

### Scope roots

`scopeRoots` sets the root orchestrator pipelines that `graph_generate_scope` walks when no `roots` argument is given:

```json
{
  "environments": {
    "work-repo": {
      "path": "C:/repos/work-repo",
      "default": true,
      "scopeRoots": ["onprem_NightlyOrganizationLoad_v2", "onprem_Orchestration_DeltaLoad"]
    }
  }
}
```

Resolution order: the tool's `roots` argument, then the environment's `scopeRoots` (merged `+overlays` views use the base environment's), then the built-in Wave 3 roots.

### Priority

1. `ADF_CONFIG` env var (explicit path to config file)
2. `adf-graph.json` next to `dist/server.js`
3. `ADF_ROOT` env var
4. Error with helpful message

## Publishing

### npm publish workflow

1. Update `version` in both `package.json` and `server.json` (they must match)
2. `npm run build`
3. `npm test`
4. `npm publish --access public`

Authenticate via `npm login` or `NPM_TOKEN` env var. Never store tokens in the repo (`.npmrc` is in `.gitignore`).

### MCP registry

The `server.json` file follows the [MCP server manifest schema](https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json) and is included in the published npm package. To list or update the package in the MCP server registry, submit a PR to [github.com/modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) referencing the npm package.
