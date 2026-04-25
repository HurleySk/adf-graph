# Code Graph MCP Server — Design Spec

**Date:** 2026-04-25
**Status:** Draft
**Repo:** New standalone repo (`code-graph`), modeled on `adf-graph`

## Overview

An MCP server that builds a queryable dependency graph from C# source code using Roslyn semantic analysis. Exposes graph traversal, impact analysis, call tracing, and data flow tools. Starts with the boomerang- codebase, designed to support additional languages later via pluggable parsers.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Primary language target | C# (.NET) | boomerang- codebase is the first target |
| Parser | Roslyn (Microsoft.CodeAnalysis) | Full semantic analysis — resolved types, overloads, generics |
| Server language | C# | Single stack with Roslyn, no cross-process shelling |
| Graph granularity | Adaptive (medium default, fine on demand) | Prebuilt graph for structural queries, live Compilation for drill-down |
| Input | .sln / .csproj file | Roslyn workspace API loads solutions natively |
| Architecture | Hybrid — prebuilt graph + live Roslyn Compilation | Fast traversal from graph, precise analysis from compiler |
| MCP transport | stdio | Same as adf-graph |

## Graph Model

### Node Types

| Type | Represents | ID Format |
|------|-----------|-----------|
| `Namespace` | C# namespace | `namespace:Boomerang.StepHandlers` |
| `Class` | Class or struct | `class:Boomerang.StepHandlers.AdfRunStepHandler` |
| `Interface` | Interface | `interface:Boomerang.StepHandlers.IStepHandler` |
| `Enum` | Enum type | `enum:Boomerang.Models.StepType` |
| `Method` | Method or constructor | `method:AdfRunStepHandler.Execute(TaskStep,JsonElement)` |
| `Property` | Property | `property:AdfRunStepHandler.Name` |
| `Field` | Field | `field:AdfRunStepHandler._config` |

Node IDs use fully qualified names from Roslyn's symbol display format, prefixed by type (matching adf-graph's `pipeline:`, `activity:` convention).

Node metadata includes: file path, line number, accessibility (public/private/etc.), modifiers (static, abstract, virtual, sealed), and for methods — parameter signatures and return type.

### Edge Types

| Type | From → To | Meaning |
|------|-----------|---------|
| `ContainedIn` | Method/Property/Field → Class | Type contains member |
| `Calls` | Method → Method | Method invokes another method |
| `Implements` | Class → Interface | Class implements interface |
| `Inherits` | Class → Class | Class extends base class |
| `UsesType` | Method → Class/Interface | Parameter/return type reference |
| `ReadsField` | Method → Field/Property | Method reads a member |
| `WritesField` | Method → Field/Property | Method writes a member |
| `DependsOn` | Class → Class | Constructor injection / field dependency |
| `OverridesMethod` | Method → Method | Virtual/override relationship |

### Graph Class

Same structure as adf-graph's `Graph`: `Dictionary<string, GraphNode>` for nodes, `Dictionary<string, List<GraphEdge>>` for forward and reverse adjacency lists. Provides `TraverseDownstream()`, `TraverseUpstream()`, `FindPaths()`, `GetNodesByType()`, `Stats()`, and `Clone()`.

## Multi-Pass Builder

Four passes, mirroring adf-graph's `buildGraph()`:

### Pass 1 — Types (structural skeleton)

- Walk all `SyntaxTree`s in the Roslyn compilation
- Create `Namespace`, `Class`, `Interface`, `Enum` nodes
- Create `Inherits` and `Implements` edges from base type lists
- Uses `SyntaxTree` only (fast)

### Pass 2 — Members

- Walk each type's member declarations
- Create `Method`, `Property`, `Field` nodes
- Create `ContainedIn` edges (member → owning type)
- Create `OverridesMethod` edges for override/virtual pairs
- Uses `SyntaxTree` only (fast)

### Pass 3 — References (semantic analysis)

- Walk method bodies using Roslyn's `SemanticModel`
- Resolve `InvocationExpression` → `Calls` edges (fully resolved symbol targets)
- Resolve `MemberAccessExpression` → `ReadsField` / `WritesField` edges
- Resolve constructor/type usage → `UsesType` edges
- Detect constructor injection patterns → `DependsOn` edges (class-level)
- Uses `SemanticModel` (slower, but precise — this is where Roslyn's value lives)

### Pass 4 — Stubs

- Collect all referenced node IDs with no definition in the graph
- Create stub nodes marked `{ stub: true, assembly: "..." }`
- Covers external dependencies (System.*, NuGet packages)
- Same pattern as adf-graph's stub pass

Returns `BuildResult { Graph, Warnings, BuildTimeMs }`.

## MCP Tools

Eight tools, drawing from adf-graph's patterns:

### code_stats

Graph statistics: node/edge counts by type, build time, staleness, warnings.

### code_find_callers

**Parameters:** `target` (node ID or name), `depth` (default 1)

Find what calls a method or uses a class. Equivalent to adf-graph's `graph_find_consumers`. Returns caller chain with relationship types.

### code_describe_type

**Parameters:** `name` (type name or ID), `depth` ("summary" | "members" | "full")

Describe a class or interface at three detail levels:

- **summary**: Name, kind, base class, interfaces, file location, accessibility
- **members**: + all methods/properties/fields with signatures and modifiers
- **full**: + what each method calls, reads, writes — the full subgraph rooted at that type

Equivalent to adf-graph's `graph_describe_pipeline`.

### code_impact_analysis

**Parameters:** `target` (node ID or name), `direction` ("upstream" | "downstream" | "both"), `maxDepth` (default 10)

If this method/class changes, what's affected? Traverses callers (upstream) or callees (downstream). Returns affected nodes with paths. Equivalent to adf-graph's `graph_impact_analysis`.

### code_find_paths

**Parameters:** `from` (node ID or name), `to` (node ID or name), `maxDepth` (default 20)

Find all dependency paths between two nodes. "How does MainMenu reach AdfRunStepHandler?" Equivalent to adf-graph's `graph_find_paths`.

### code_find_implementations

**Parameters:** `target` (interface or virtual method name)

Find all classes implementing an interface, or all overrides of a virtual/abstract method. No direct adf-graph equivalent — new for code analysis.

### code_data_flow

**Parameters:** `method` (method name or ID), `parameter` (optional — specific parameter to trace)

Fine-grained Roslyn drill-down. Traces data flow through a specific method: parameter → assignments → returns. Queries the live `Compilation` on demand rather than the prebuilt graph. This is the adaptive "fine" layer. Equivalent to adf-graph's `graph_data_lineage`.

### code_search

**Parameters:** `pattern` (regex or glob), `nodeType` (optional filter)

Search nodes by name pattern. Discovery tool: "find all StepHandlers", "find methods matching *Execute*". No direct adf-graph equivalent.

## Server Architecture

### Project Structure

```
code-graph/
├── CodeGraph.sln
├── src/
│   └── CodeGraph.Server/
│       ├── CodeGraph.Server.csproj
│       ├── Program.cs              # Entry point, MCP server setup
│       ├── Config.cs               # Config loading
│       ├── Graph/
│       │   ├── Model.cs            # Graph, GraphNode, GraphEdge, enums
│       │   ├── Builder.cs          # 4-pass Roslyn graph builder
│       │   └── Staleness.cs        # Mtime-based rebuild tracking
│       ├── Analysis/
│       │   └── DataFlowAnalyzer.cs # Fine-grained Roslyn drill-down
│       └── Tools/
│           ├── Stats.cs
│           ├── FindCallers.cs
│           ├── DescribeType.cs
│           ├── ImpactAnalysis.cs
│           ├── FindPaths.cs
│           ├── FindImplementations.cs
│           ├── DataFlow.cs
│           └── Search.cs
└── tests/
    └── CodeGraph.Tests/
        ├── CodeGraph.Tests.csproj
        └── ...
```

### Dependencies

- `Microsoft.CodeAnalysis.CSharp.Workspaces` — Roslyn solution/project loading + semantic analysis
- `ModelContextProtocol` — .NET MCP SDK for server hosting and tool registration
- `System.Text.Json` — serialization (no Newtonsoft dependency)

### Configuration

Two-tier priority:

1. `code-graph.json` next to executable:
   ```json
   {
     "solution": "C:/path/to/Boomerang.sln"
   }
   ```
2. `CODE_GRAPH_SOLUTION` env var pointing at a .sln file

### Staleness & Caching

Same pattern as adf-graph's `StalenessChecker`:

- Track max mtime across all `.cs` files in the solution directory tree
- On first query: load solution via `MSBuildWorkspace`, build `Compilation`, run 4-pass builder
- Cache the `Graph` and `Compilation` in memory
- On subsequent queries: check staleness, rebuild if any .cs file is newer than last build
- Both graph and Compilation are invalidated together

### Compilation Lifecycle

- `MSBuildWorkspace.OpenSolutionAsync()` loads the solution
- Each project yields a `Compilation` with full semantic model
- The Compilation stays alive for `code_data_flow` drill-down queries
- On stale rebuild: dispose old workspace/compilation, reload everything
- For boomerang's 79 files, memory is not a concern; for larger solutions, could release Compilation after build and reload on demand

## Future Extensions

These are explicitly out of scope for v1 but the architecture supports them:

- **Multi-language support**: Add parsers (tree-sitter based) that emit the same node/edge types. The Graph model and MCP tools are language-agnostic.
- **Multi-environment**: Add adf-graph-style `environments` config to compare branches, solutions, or versions side by side.
- **Overlays**: Layer WIP/uncommitted changes on top of a base graph.
- **Incremental rebuild**: Use Roslyn's `Workspace.DocumentChanged` events for file-level incremental updates instead of full rebuild.
