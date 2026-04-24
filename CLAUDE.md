# adf-graph

MCP server that builds a queryable dependency graph from ADF pipeline artifacts.

## Build & Test

- Build: `npm run build`
- Test: `npm test`
- Dev: `npm run dev` (watch mode)

## Architecture

- `src/graph/model.ts` — Graph data structure (nodes, edges, adjacency lists)
- `src/graph/builder.ts` — 4-pass graph builder (pipelines → datasets → SQL → enrichment)
- `src/graph/staleness.ts` — File mtime tracking, rebuild-if-stale
- `src/parsers/` — One parser per artifact type (pipeline, dataset, sql, columns)
- `src/tools/` — One file per MCP tool
- `src/server.ts` — MCP server entry point, tool registration

## Configuration

`ADF_ROOT` env var — path to directory containing ADF artifacts (`pipeline/`, `dataset/`, etc.)
