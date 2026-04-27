# adf-graph v0.7.0 — Issue #5 Features + Refactoring

## Context

GitHub Issue #5 captures five feature gaps identified during real-world usage in the boomerang data migration project. Separately, a code analysis identified nine refactoring opportunities where duplicated patterns, unsafe type casts, and monolithic files have accumulated across v0.1–v0.6. This design addresses both: refactoring first to establish a clean foundation, then building all five features on top.

**Goal**: Ship a v0.7.0 release that closes Issue #5 and measurably improves code quality.

---

## Phase 1: Refactoring (8 steps, no behavior changes)

All 208 existing tests must pass after each step. No external API changes.

### Step 1: `src/constants.ts`

Centralize scattered magic strings.

**Creates**: `src/constants.ts`

```typescript
export const ADF_DIRS = {
  PIPELINE: "pipeline",
  DATASET: "dataset",
  LINKED_SERVICE: "linkedService",
  SQL: "SQL DB",
} as const;

export const OVERLAY_SUFFIX = "+overlays";

export const WATCHED_DIRS = ["pipeline", "dataset", "linkedService", "SQL DB"] as const;
```

**Modifies**: `builder.ts` (replace 4 string literals), `manager.ts` (replace local OVERLAY_SUFFIX), `staleness.ts` (replace WATCHED_DIRS), `overlay.ts` (replace adfDirs array).

### Step 2: `src/utils/nodeId.ts`

Centralize node ID construction and parsing.

**Creates**: `src/utils/nodeId.ts`, `tests/utils/nodeId.test.ts`

```typescript
export function makeNodeId(type: string, name: string): string;
export function makeActivityId(pipeline: string, activity: string): string;
export function parseNodeId(id: string): { type: string; name: string };
export function parseActivityId(id: string): { pipeline: string; activity: string };
```

**Modifies**: `builder.ts`, `consumers.ts`, `describe.ts`, `search.ts`, `deployReadiness.ts`, `traceParameters.ts`, `lineage.ts` — replace ad-hoc slice/split/indexOf patterns.

### Step 3: `src/graph/nodeMetadata.ts`

Typed metadata interfaces and safe accessor functions.

**Creates**: `src/graph/nodeMetadata.ts`, `tests/graph/nodeMetadata.test.ts`

```typescript
export interface ParameterDef {
  name: string;
  type: string;
  defaultValue: unknown;
}

export interface PipelineMetadata { parameters: ParameterDef[] }
export interface ActivityMetadata {
  activityType: string;
  sqlQuery?: string;
  fetchXmlQuery?: string;
  storedProcedureName?: string;
  storedProcedureParameters?: Record<string, unknown>;
  pipelineParameters?: Record<string, unknown>;
  executedPipeline?: string;
}
// + DatasetMetadata, LinkedServiceMetadata, StubMetadata

export function getPipelineMetadata(node: GraphNode): PipelineMetadata;
export function getActivityMetadata(node: GraphNode): ActivityMetadata;
export function getParameterDefs(node: GraphNode): ParameterDef[];
export function isStub(node: GraphNode): boolean;
```

**Modifies**: `describe.ts`, `search.ts`, `deployReadiness.ts`, `traceParameters.ts`, `lineage.ts` — replace `as` casts with safe accessors. Extracts `ParameterDef` from `describe.ts` to shared location.

### Step 4: Builder boilerplate extraction

Extract generic directory scanning from `builder.ts`.

```typescript
function processJsonDirectory(
  rootPath: string,
  dirName: string,
  parser: (json: unknown) => ParseResult,
  graph: Graph,
  warnings: string[],
  postProcess?: (graph: Graph, warnings: string[]) => void,
): void;
```

**Modifies**: `builder.ts` — replaces 3 near-identical scanning loops (passes 1–3). Pass 1's column-mapping extraction becomes a `postProcess` callback.

### Step 5: `src/graph/traversalUtils.ts`

Generic graph traversal utilities.

**Creates**: `src/graph/traversalUtils.ts`, `tests/graph/traversalUtils.test.ts`

```typescript
export function traverseByEdgeTypes(
  graph: Graph,
  startId: string,
  direction: "upstream" | "downstream",
  options?: { edgeFilter?: (edge: GraphEdge) => boolean; maxDepth?: number },
): TraversalResult[];

export function findExecutePipelineActivities(
  graph: Graph,
  pipelineId: string,
): GraphNode[];

export function walkDependencyTree(
  graph: Graph,
  startId: string,
  options?: { skipEdgeTypes?: EdgeType[] },
): Map<string, { referencedBy: string }>;
```

**Modifies**: `deployReadiness.ts` (replace `walkDependencies`), `traceParameters.ts` (replace `recurseIntoChildren` exec-activity lookup).

### Step 6: `src/tools/toolUtils.ts`

Shared tool handler patterns.

**Creates**: `src/tools/toolUtils.ts`, `tests/tools/toolUtils.test.ts`

```typescript
export function resolveNodeId(targetType: string, target: string): string;
export function lookupPipelineNode(
  graph: Graph, pipeline: string
): { node: GraphNode; id: string } | { error: string; id: string };
```

**Modifies**: `consumers.ts`, `impact.ts`, `paths.ts`, `describe.ts`, `deployReadiness.ts`, `traceParameters.ts`.

### Step 7: Pipeline parser split

Break `src/parsers/pipeline.ts` (251 lines) into focused modules.

**Creates**:
- `src/parsers/parseResult.ts` — `ParseResult` interface (currently in pipeline.ts)
- `src/parsers/activities/base.ts` — common activity node + Contains/DependsOn edges
- `src/parsers/activities/executePipeline.ts` — ExecutePipeline handling
- `src/parsers/activities/copy.ts` — Copy activity I/O, SQL/FetchXML, column mappings
- `src/parsers/activities/storedProcedure.ts` — SP activity handling
- `src/parsers/activities/index.ts` — dispatcher + re-exports

**Modifies**: `pipeline.ts` (slim orchestrator), `dataset.ts`, `sql.ts` (update ParseResult imports).

**Risk**: Highest in the plan. The `nodes` array mutation pattern (activity handlers modify nodes created by base handler) needs careful interface design. Mitigated by strong existing test coverage (16 parser tests).

### Step 8: Overlay merge clarity

**Modifies**: `model.ts` (add `allEdges()` method), `overlay.ts` (edge deduplication in `mergeOverlayInto`, improved clarity).

---

## Phase 2: Features (5 new tools, implementation order: 1 → 3 → 4 → 2 → 5)

### Feature 1: `graph_find_orchestrators`

**Tool**: `graph_find_orchestrators`
**Description**: Find root orchestrator pipelines that own a given pipeline. Returns full ancestry chains with depth.

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| pipeline | string | yes | Pipeline name to trace ancestry for |
| environment | string | no | Environment name |

**Return type**:
```typescript
interface AncestryChain {
  root: string;
  chain: string[];   // ordered root → target
  depth: number;
}

interface OrchestratorAncestryResult {
  pipeline: string;
  isRoot: boolean;
  ancestors: AncestryChain[];
  error?: string;
}
```

**Algorithm**:
1. Resolve `pipeline:{name}` node.
2. Walk upstream following only `Executes` edges (using `traverseByEdgeTypes`).
3. At each pipeline with no incoming Executes edges → root. Record full chain (reversed to root-first).
4. Cycle protection via visited set.

**Files**: Create `src/tools/findOrchestrators.ts`, `tests/tools/findOrchestrators.test.ts`. Modify `src/server.ts`.

### Feature 2: `graph_diff_environments`

**Tool**: `graph_diff_environments`
**Description**: Compare pipelines across two environments. Returns added/removed/changed pipelines with summary-level diffs.

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| envA | string | yes | First environment |
| envB | string | yes | Second environment |
| scope | "pipelines" \| "all" | no (default: "pipelines") | What to compare |

**Return type**:
```typescript
interface PipelineDiffSummary {
  name: string;
  status: "added" | "removed" | "modified" | "unchanged";
  changes?: string[];
}

interface EnvironmentDiffResult {
  envA: string;
  envB: string;
  summary: { added: number; removed: number; modified: number; unchanged: number };
  pipelines: PipelineDiffSummary[];
  error?: string;
}
```

**Algorithm**:
1. `manager.ensureGraph(envA)` and `manager.ensureGraph(envB)`.
2. Collect pipeline nodes from each. Set difference for added/removed.
3. For shared pipelines, reuse `handleDiffPipeline` internally. Classify as modified/unchanged.
4. Generate brief `changes` summaries for modified pipelines.

**Scope "all"**: When `scope` is "all", additionally compare dataset and linked service nodes between environments using the same set-difference approach (added/removed/modified by name). Modified datasets are detected by comparing their metadata (type, parameters, linked service reference). This is a lightweight extension of the pipeline comparison — no deep structural diff needed for non-pipeline node types.

**Design note**: Handler receives `GraphManager` (not single Graph) — same pattern as overlay/env management tools.

**Files**: Create `src/tools/diffEnvironments.ts`, `tests/tools/diffEnvironments.test.ts`. Modify `src/server.ts`.

### Feature 3: `graph_validate`

**Tool**: `graph_validate`
**Description**: Graph-wide health check. Flags broken references (errors) and quality issues (warnings).

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| environment | string | no | Environment name |
| severity | "all" \| "error" \| "warning" | no (default: "all") | Filter results |

**Return type**:
```typescript
interface ValidationIssue {
  severity: "error" | "warning";
  category: string;
  message: string;
  nodeId?: string;
  relatedNodeId?: string;
}

interface GraphValidationResult {
  environment: string;
  issueCount: { errors: number; warnings: number };
  issues: ValidationIssue[];
}
```

**Validation rules**:

Errors:
- Broken SP references: `calls_sp` edges to stub/missing nodes
- Missing child pipelines: `Executes` edges to stub/missing pipeline nodes
- Broken table references: `reads_from`/`writes_to` to stub tables
- Broken dataset references: `uses_dataset` to stub datasets
- Broken linked service references: `uses_linked_service` to stub linked services

Warnings:
- Empty parameter defaults: pipeline params with empty/null defaultValue
- Unused datasets: dataset nodes with no incoming edges
- Missing linked service connections: datasets with no `uses_linked_service` edge
- Orphan nodes: nodes with zero edges in either direction

**Files**: Create `src/tools/validate.ts`, `tests/tools/validate.test.ts`. Modify `src/server.ts`.

### Feature 4: `graph_search`

**Tool**: `graph_search`
**Description**: Flexible search with filters and configurable verbosity.

**Parameters**:
| Name | Type | Required | Description |
|------|------|----------|-------------|
| query | string (min 1) | yes | Text pattern (case-insensitive) |
| activityType | string | no | Filter by activity type |
| nodeType | NodeType enum | no | Filter by node type |
| targetEntity | string | no | Filter to activities reading/writing entity |
| pipeline | string | no | Limit to a specific pipeline |
| detail | "summary" \| "full" | no (default: "summary") | Verbosity level |
| environment | string | no | Environment name |

**Return type**:
```typescript
interface SearchHit {
  pipeline: string;
  activity: string;
  activityType: string;
  field: string;
  snippet?: string;      // full mode only
  targets?: string[];    // entities this activity reads/writes
}

interface EnhancedSearchResult {
  query: string;
  filters?: Record<string, string>;
  totalHits: number;
  hits: SearchHit[];
}
```

**Algorithm**:
1. Start with all activity nodes.
2. Apply filters: activityType (metadata check), pipeline (ID prefix), nodeType, targetEntity (follow reads_from/writes_to/calls_sp edges).
3. Search remaining candidates across text fields (SQL, FetchXML, SP names/params, pipeline params, node names).
4. Summary mode: omit snippet. Full mode: include matching text context.

**Coexistence**: New tool alongside existing `graph_search_queries` (which remains for backward compatibility).

**Files**: Create `src/tools/enhancedSearch.ts`, `tests/tools/enhancedSearch.test.ts`. Modify `src/server.ts`.

### Feature 5: SP Transform Tracing

Three sub-components working together to close the lineage gap through stored procedures.

#### 5a. SQL Body Parser: `src/parsers/spColumnParser.ts`

**Input**: SQL text (string) from SP `.sql` file.

**Output**:
```typescript
interface SpColumnMapping {
  sourceTable: string;
  sourceColumn: string;
  targetTable: string;
  targetColumn: string;
  transformExpression?: string;
}

interface SpParseResult {
  storedProcedure: string;
  mappings: SpColumnMapping[];
  readTables: string[];
  writeTables: string[];
  warnings: string[];
  confidence: "high" | "medium" | "low";
}
```

**SQL patterns handled (priority order)**:
1. `UPDATE...SET col = expr` — target table/columns explicit, source from expression
2. `INSERT INTO...SELECT` — positional column matching between INSERT list and SELECT list
3. `MERGE...USING...WHEN MATCHED/NOT MATCHED` — extract mappings from UPDATE SET and INSERT clauses
4. `SELECT INTO` — target = new table, columns from SELECT
5. Expression parsing: extract innermost column reference from `UPPER(LTRIM(RTRIM(col)))`, store full expression as `transformExpression`
6. Dynamic SQL / EXEC: flag as unparseable, set confidence to "low"

**Strategy**: Regex-based with state machine. Not a full T-SQL parser. The `confidence` field communicates parse completeness. This is pragmatic: a full parser would be 10x the effort, and most data migration SPs are straightforward UPDATE/INSERT/MERGE patterns.

#### 5b. Graph Builder Integration

**Modifies**: `src/graph/builder.ts` (Pass 4 enhancement)

After creating SP nodes from the SQL directory, read each SP's `.sql` file, parse with `spColumnParser`, and emit:
- `reads_from` edges from SP node to each source table
- `writes_to` edges from SP node to each target table
- `maps_column` edges on SP node with sourceTable, sourceColumn, targetTable, targetColumn, transformExpression in metadata

#### 5c. Lineage Tool Enhancement

**Modifies**: `src/tools/lineage.ts`

When lineage traces through an activity with `calls_sp` edge, continue through SP node's `reads_from`/`writes_to` edges to reach underlying tables. For column-level lineage (`attribute` parameter), also check `maps_column` edges on SP nodes.

**Files created**: `src/parsers/spColumnParser.ts`, `tests/parsers/spColumnParser.test.ts`. New SP fixture files with INSERT/SELECT, MERGE patterns.

**Risk assessment**:
| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Regex can't handle complex SQL | High | `confidence` field signals gaps. Start with UPDATE/INSERT, add MERGE. |
| Dynamic SQL in SPs | Medium | Flag as unparseable, emit warning. Most SPs use static SQL. |
| Temp tables break resolution | Medium | Track temp aliases during parsing. Unresolvable → warning. |
| Complex expressions | Medium | Store full expression, extract best-guess source column. |
| CTE resolution | Medium | First version treats CTEs as opaque. |

---

## Implementation Order

```
Phase 1 (Refactoring):
  Step 1: constants.ts
  Step 2: utils/nodeId.ts          (depends on 1)
  Step 3: graph/nodeMetadata.ts    (parallel with 2)
  Step 4: builder boilerplate      (depends on 1)
  Step 5: graph/traversalUtils.ts  (depends on 2, 3)
  Step 6: tools/toolUtils.ts       (depends on 2, 3)
  Step 7: pipeline parser split    (depends on 1, 2)
  Step 8: overlay merge clarity    (depends on 1)

Phase 2 (Features):
  Feature 1: find_orchestrators    (depends on steps 5, 6)
  Feature 3: validate              (depends on steps 3, 6)
  Feature 4: search                (depends on steps 2, 3, 6)
  Feature 2: diff_environments     (depends on step 6, existing diff.ts)
  Feature 5: SP transform tracing  (depends on all refactoring, features 1-4 stable)
```

## Verification

After each step/feature:
1. `npm run build` — zero errors
2. `npm test` — all tests pass (208 existing + new tests)

After all work:
3. Run each new MCP tool against real ADF artifacts (work-repo environment)
4. Verify `graph_find_orchestrators` returns correct ancestry for known pipelines
5. Verify `graph_diff_environments` catches known drift between environments
6. Verify `graph_validate` flags known broken references
7. Verify `graph_search` returns results matching existing `graph_search_queries` for same query, plus filtered results
8. Verify lineage traces now continue through SP boundaries

## Version Bump

Update `version` in both `package.json` and `server.json` to `0.7.0` before publishing.
