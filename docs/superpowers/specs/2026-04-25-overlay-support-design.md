# Overlay Support for adf-graph

**Date:** 2026-04-25
**Status:** Approved

## Problem

Users frequently work in repos with multiple ADF files scattered across locations. There is a "main" repo with the established codebase, but users also have local in-progress files — new pipelines, modified datasets, experimental artifacts — that need to be included in the graph alongside the main repo. Today, each environment is a single isolated root path with no way to layer additional files on top.

## Goals

- Let users overlay local files onto an existing environment's graph (replace matching artifacts, add new ones).
- Preserve the clean base graph for comparison — in-progress work is conceptually different from the established codebase.
- Support both structured overlay directories (with `pipeline/`, `dataset/` subdirs) and loose files without ADF folder structure.
- Give agents runtime control over environments and overlays without requiring config file edits.

## Non-Goals

- Deep JSON property merging within a single artifact (overlay replaces the entire artifact).
- Persisting runtime-added environments or overlays across server restarts.
- Explicit rebuild tools (staleness detection handles this automatically).

---

## Design

### 1. Config Schema

The `EnvironmentConfig` interface gains an optional `overlays` array. Each entry is a directory path or file path.

```json
{
  "environments": {
    "work-repo": {
      "path": "C:/repos/adf-main",
      "default": true,
      "overlays": [
        "C:/my-wip/",
        "C:/one-off/SomeNewPipeline.json"
      ]
    }
  }
}
```

**Rules:**

- `overlays` is optional. Environments without it behave exactly as today (no breaking changes).
- Directory entries are scanned recursively — if they have ADF structure (`pipeline/`, `dataset/`), that structure is used. If not, loose files are inspected for type.
- File entries are individually inspected for type.
- Order matters — later overlays win when two overlays define the same artifact.
- When overlays are present, two environments appear in `listEnvironments()`: the base (`work-repo`) and the merged view (`work-repo+overlays`). The default designation stays on the base.
- Environment names containing `+` are rejected at config validation time (reserved for merged view naming).

### 2. File Type Detection

For structured overlay directories (containing `pipeline/`, `dataset/`, etc.), type is inferred from subdirectory — same as the existing builder logic.

For loose files, a new `detectArtifactType()` function inspects file content:

| Signal | Detected Type |
|--------|--------------|
| `.sql` extension | SQL script (routed to SQL parser) |
| JSON with `properties.activities` array | Pipeline |
| JSON with `properties.typeProperties` + `type` matching dataset patterns (e.g., `AzureSqlTable`, `DelimitedText`) | Dataset |
| None of the above | Warning emitted, file skipped |

**Detection order:**

1. `.sql` extension → SQL.
2. `.json` extension → parse and check signals above.
3. Non-JSON/non-SQL files → skip silently.
4. Ambiguous JSON → warning: `"Could not determine artifact type for 'Foo.json' — skipping"`.

The detector does not need to be exhaustive on day one. Pipeline and dataset are the critical types. Heuristics can be expanded as new patterns emerge.

### 3. Graph Building with Overlays

The core `buildGraph()` function stays unchanged — it builds a graph from a single root path. Overlay logic lives in the `GraphManager` layer.

**Build flow for an environment with overlays:**

1. **Build base graph** — call `buildGraph(envConfig.path)` as today. This produces the clean base graph.
2. **Clone the base graph** — deep copy the base graph to start the merged view.
3. **Apply overlays in order** — for each overlay path:
   - Directory with ADF structure → call `buildGraph()` on it, producing a partial graph.
   - Directory without ADF structure → scan loose files, detect types, parse each into nodes/edges.
   - Single file → detect type, parse into nodes/edges.
   - Merge into the cloned graph: **matching node IDs replace** (overlay wins), **new node IDs are added**. Edges from overlaid nodes replace the original edges for those nodes.
4. **Store both** — base graph and merged graph are stored as separate `EnvState` entries in the `GraphManager` map.

**Replace semantics:** When a node ID like `pipeline:Foo` exists in both base and overlay, the overlay version completely replaces it — its activities, edges, everything. This is full artifact replacement, not deep JSON property merging.

**New file:** `src/graph/overlay.ts` — overlay scanning, type detection, and merge-on-top-of-clone logic.

### 4. Runtime MCP Tools

Five new tools, each in its own file under `src/tools/`:

#### Overlay Management

| Tool | Input | Behavior |
|------|-------|----------|
| `graph_add_overlay` | `environment: string`, `path: string` | Adds a path (dir or file) as an overlay to the named environment. Invalidates the merged view so it rebuilds on next query. Returns confirmation + overlay list. |
| `graph_remove_overlay` | `environment: string`, `path: string` | Removes a runtime overlay. Config-based overlays cannot be removed (returns error with guidance to edit config). Invalidates merged view. |
| `graph_list_overlays` | `environment?: string` | Lists all overlays (config + runtime) for the environment. Flags each as `source: "config"` or `source: "runtime"`. |

#### Environment Management

| Tool | Input | Behavior |
|------|-------|----------|
| `graph_add_environment` | `name: string`, `path: string`, `overlays?: string[]` | Registers a new ephemeral environment. Fails if name collides with a config-based environment. |
| `graph_remove_environment` | `name: string` | Removes a runtime environment. Config-based environments cannot be removed (returns error). |

**Design notes:**

- All runtime additions are ephemeral — stored in-memory on the `GraphManager`, lost on restart.
- Config-based entries are protected — tools can add overlays to them but not delete them.
- `graph_list_environments` (existing tool) gains a `source: "config" | "runtime" | "derived"` field and a `hasOverlays` field.
- No explicit rebuild tool — adding/removing overlays or environments invalidates staleness, triggering rebuild on next query.

### 5. Staleness Handling

- The merged view (`work-repo+overlays`) gets its own `StalenessChecker` that watches all paths: the base path + every overlay path.
- The base environment's staleness checker stays unchanged — watches only its own root.
- File change in an overlay path → only the merged view goes stale. Base stays fresh.
- File change in the base path → both base and merged view go stale.
- Runtime overlay additions immediately register with the merged view's staleness checker and invalidate the merged graph.
- Runtime overlay removals unregister from the staleness checker and invalidate the merged graph.

**Implementation:** `StalenessChecker` gains support for multiple watched paths (array of paths instead of single root). Simpler than a composite wrapper — less indirection.

### 6. Merged Environment Naming & UX

- Base environment: keeps its name as-is (`work-repo`).
- Merged view: `{name}+overlays` (e.g., `work-repo+overlays`).
- The `+` character is reserved — config validation rejects environment names containing `+`.
- If an environment has overlays, the **merged view becomes the default** when no environment is specified in a query. Rationale: if you've set up overlays, you want the combined picture.
- Explicitly passing `environment: "work-repo"` returns the clean base graph. Passing `environment: "work-repo+overlays"` (or omitting the parameter when `work-repo` is the default) returns the merged view.
- `graph_list_environments` output example:

```json
[
  { "name": "work-repo", "source": "config", "hasOverlays": true, "nodeCount": 42 },
  { "name": "work-repo+overlays", "source": "derived", "nodeCount": 47 }
]
```

- When all overlays are removed (empty config array, all runtime overlays cleared), the `+overlays` entry disappears. No phantom empty merged views.

---

## Files Changed

| File | Change |
|------|--------|
| `src/config.ts` | Add optional `overlays` to `EnvironmentConfig`, validate `+` in names |
| `src/graph/overlay.ts` | **New.** Type detection, overlay scanning, graph cloning + merge logic |
| `src/graph/manager.ts` | Overlay-aware build flow, runtime environment/overlay storage, merged view lifecycle |
| `src/graph/model.ts` | Add `clone()` method to `Graph` |
| `src/graph/staleness.ts` | Support multiple watched paths |
| `src/tools/addOverlay.ts` | **New.** `graph_add_overlay` tool |
| `src/tools/removeOverlay.ts` | **New.** `graph_remove_overlay` tool |
| `src/tools/listOverlays.ts` | **New.** `graph_list_overlays` tool |
| `src/tools/addEnvironment.ts` | **New.** `graph_add_environment` tool |
| `src/tools/removeEnvironment.ts` | **New.** `graph_remove_environment` tool |
| `src/tools/listEnvironments.ts` | Add `source` and `hasOverlays` fields |
| `src/server.ts` | Register new tools |
