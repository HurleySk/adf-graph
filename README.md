# adf-graph

MCP server that builds a queryable dependency graph from Azure Data Factory pipeline artifacts.

Parses ADF pipelines, datasets, linked services, and SQL stored procedures into a graph of nodes and edges. Exposes six MCP tools for dependency analysis, impact assessment, and data lineage tracing.

## Quick Start

```bash
npm install
npm run build
ADF_ROOT=/path/to/work-repo node dist/server.js
```

`ADF_ROOT` must point to a directory containing `pipeline/`, `dataset/`, and/or `linkedService/` subdirectories. The graph is built lazily on the first tool call and rebuilt automatically when files change.

## MCP Configuration

Add to your Claude Desktop / Claude Code `settings.json`:

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

## Tools

| Tool | Description |
|---|---|
| `graph_stats` | Node/edge counts by type, build time, staleness flag |
| `graph_find_consumers` | All pipeline activities that read/write/call a given artifact |
| `graph_describe_pipeline` | Pipeline summary, activity list, or full detail with column mappings |
| `graph_impact_analysis` | All nodes affected upstream/downstream if an artifact changes |
| `graph_data_lineage` | Data flow paths for a Dataverse entity or staging table; optional column filter |
| `graph_find_paths` | All dependency paths between two named nodes |

### `graph_find_consumers` / `graph_impact_analysis` target types

`pipeline`, `activity`, `dataset`, `stored_procedure`, `table`, `dataverse_entity`

### `graph_describe_pipeline` depth values

- `summary` — name, parameters, child pipelines, root orchestrators
- `activities` — adds activity list with dependencies, sources, and sinks
- `full` — adds column-level mapping details

## Directory Structure

```
src/
  server.ts          # MCP server entry point
  graph/
    model.ts         # Graph, NodeType, EdgeType definitions
    builder.ts       # Builds graph from ADF_ROOT
    staleness.ts     # Mtime-based cache invalidation
  tools/
    stats.ts         # graph_stats handler
    consumers.ts     # graph_find_consumers handler
    describe.ts      # graph_describe_pipeline handler
    impact.ts        # graph_impact_analysis handler
    lineage.ts       # graph_data_lineage handler
    paths.ts         # graph_find_paths handler
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
