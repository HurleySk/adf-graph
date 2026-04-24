# adf-graph

MCP server that builds a queryable dependency graph from ADF pipeline artifacts.

## Build & Test

- Build: `npm run build`
- Test: `npm test`
- Dev: `npm run dev` (watch mode)

## Architecture

- `src/config.ts` — Config loader (ADF_CONFIG / adf-graph.json / ADF_ROOT fallback)
- `src/graph/model.ts` — Graph data structure (nodes, edges, adjacency lists)
- `src/graph/builder.ts` — 4-pass graph builder (pipelines → datasets → SQL → enrichment)
- `src/graph/staleness.ts` — File mtime tracking, rebuild-if-stale
- `src/graph/manager.ts` — Multi-environment graph manager (lazy build, per-env staleness)
- `src/parsers/` — One parser per artifact type (pipeline, dataset, sql, columns)
- `src/tools/` — One file per MCP tool
- `src/server.ts` — MCP server entry point, tool registration

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

### Priority

1. `ADF_CONFIG` env var (explicit path to config file)
2. `adf-graph.json` next to `dist/server.js`
3. `ADF_ROOT` env var
4. Error with helpful message
