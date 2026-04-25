# adf-graph

MCP server that builds a queryable dependency graph from Azure Data Factory pipeline artifacts.

Parses ADF pipelines, datasets, linked services, and SQL stored procedures into a graph of nodes and edges. Exposes MCP tools for dependency analysis, impact assessment, data lineage tracing, and environment/overlay management.

## Quick Start

```bash
npm install
npm run build
ADF_ROOT=/path/to/work-repo node dist/server.js
```

`ADF_ROOT` must point to a directory containing `pipeline/`, `dataset/`, and/or `linkedService/` subdirectories. The graph is built lazily on the first tool call and rebuilt automatically when files change.

## Multi-environment Configuration

To query multiple ADF roots (e.g. your work repo and a live dev factory export), create `adf-graph.json` in the repo root (next to `dist/`):

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

Each environment has its own lazily-built graph and staleness tracker. Use the optional `environment` parameter on any tool to target a specific environment. Omit it to use the default.

You can also set `ADF_CONFIG=/absolute/path/to/adf-graph.json` to use a config file at an arbitrary location (takes priority over the sidecar file).

### Overlays

Environments can have an optional `overlays` array to layer local or in-progress files on top of the base graph:

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
- Runtime additions are ephemeral (lost on server restart).

## MCP Configuration

### Single environment (ADF_ROOT)

```json
{
  "mcpServers": {
    "adf-graph": {
      "command": "node",
      "args": ["/path/to/adf-graph/dist/server.js"],
      "env": {
        "ADF_ROOT": "/path/to/work-repo"
      }
    }
  }
}
```

### Multi-environment (config file)

```json
{
  "mcpServers": {
    "adf-graph": {
      "command": "node",
      "args": ["/path/to/adf-graph/dist/server.js"],
      "env": {
        "ADF_CONFIG": "/path/to/adf-graph.json"
      }
    }
  }
}
```

## Tools

All tools except `graph_list_environments` accept an optional `environment` parameter. Omit it to use the default environment.

| Tool | Description |
|---|---|
| `graph_stats` | Node/edge counts by type, build time, staleness flag |
| `graph_find_consumers` | All pipeline activities that read/write/call a given artifact |
| `graph_describe_pipeline` | Pipeline summary, activity list, or full detail with SQL queries and column mappings |
| `graph_impact_analysis` | All nodes affected upstream/downstream if an artifact changes |
| `graph_data_lineage` | Data flow paths for a Dataverse entity or staging table; optional column filter and depth limit |
| `graph_find_paths` | All dependency paths between two named nodes |
| `graph_search_queries` | Search across all activity SQL and FetchXML for a text pattern |
| `graph_diff_pipeline` | Compare a pipeline's structure across two environments |
| `graph_list_environments` | List all configured environments with paths, stats, and staleness status |
| `graph_add_overlay` | Add an overlay path to an environment (runtime, ephemeral) |
| `graph_remove_overlay` | Remove a runtime overlay from an environment |
| `graph_list_overlays` | List all overlays (config + runtime) for an environment |
| `graph_add_environment` | Register a new ephemeral environment pointing to an ADF root |
| `graph_remove_environment` | Remove a runtime environment |

### `graph_find_consumers` / `graph_impact_analysis` target types

`pipeline`, `activity`, `dataset`, `stored_procedure`, `table`, `dataverse_entity`

### `graph_describe_pipeline` depth values

- `summary` — name, parameters, child pipelines, root orchestrators
- `activities` — adds activity list with dependencies, sources, and sinks
- `full` — adds SQL queries, FetchXML, and column-level mapping details

### `graph_data_lineage` depth limiting

Use the optional `maxDepth` parameter to limit traversal depth (number of hops). Useful for large graphs where unlimited traversal produces oversized results.

### `graph_search_queries`

Searches all activity `sqlReaderQuery` and FetchXML fields for a case-insensitive substring match. Returns matching activities with the full query text.

### `graph_diff_pipeline`

Compares a pipeline's structure across two named environments. Reports added, removed, and modified activities with details on what changed (SQL, column mappings, sources, sinks).

## Directory Structure

```
src/
  config.ts          # Config loader (ADF_CONFIG / adf-graph.json / ADF_ROOT)
  server.ts          # MCP server entry point
  graph/
    model.ts         # Graph, NodeType, EdgeType definitions
    builder.ts       # Builds graph from a root path
    staleness.ts     # Mtime-based cache invalidation
    manager.ts       # Multi-environment graph manager
    overlay.ts       # Overlay scanning and graph merge
  tools/
    stats.ts         # graph_stats handler
    consumers.ts     # graph_find_consumers handler
    describe.ts      # graph_describe_pipeline handler
    impact.ts        # graph_impact_analysis handler
    lineage.ts       # graph_data_lineage handler
    paths.ts         # graph_find_paths handler
    search.ts        # graph_search_queries handler
    diff.ts          # graph_diff_pipeline handler
  parsers/
    pipeline.ts      # ADF pipeline JSON parser
    dataset.ts       # ADF dataset JSON parser
    columns.ts       # Column mapping extractor
    sql.ts           # SQL stored procedure parser
tests/
  graph/             # Graph model unit tests
  parsers/           # Parser unit tests
  tools/             # Tool handler unit tests
  integration.test.ts  # End-to-end test with real pipeline data
```

## Dev Commands

```bash
npm run build        # Compile TypeScript
npm run dev          # Watch mode
npm test             # Run all tests (vitest)
npm run test:watch   # Watch mode tests
```
