#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig } from "./config.js";
import { GraphManager } from "./graph/manager.js";
import { handleStats } from "./tools/stats.js";
import { handleFindConsumers } from "./tools/consumers.js";
import { handleDescribePipeline } from "./tools/describe.js";
import { handleImpactAnalysis } from "./tools/impact.js";
import { handleDataLineage } from "./tools/lineage.js";
import { handleFindPaths } from "./tools/paths.js";
import { handleSearchQueries } from "./tools/search.js";
import { handleDiffPipeline } from "./tools/diff.js";
import { handleAddOverlay } from "./tools/addOverlay.js";
import { handleRemoveOverlay } from "./tools/removeOverlay.js";
import { handleListOverlays } from "./tools/listOverlays.js";
import { handleAddEnvironment } from "./tools/addEnvironment.js";
import { handleRemoveEnvironment } from "./tools/removeEnvironment.js";
import { handleDeployReadiness } from "./tools/deployReadiness.js";
import { handleTraceParameters } from "./tools/traceParameters.js";
import { handleFindOrchestrators } from "./tools/findOrchestrators.js";
import { handleDiffEnvironments } from "./tools/diffEnvironments.js";
import { handleValidate } from "./tools/validate.js";
import { handleEnhancedSearch } from "./tools/enhancedSearch.js";

const config = loadConfig();
const manager = new GraphManager(config);

const server = new McpServer({
  name: "adf-graph",
  version: "0.8.2",
});

/** Shared optional environment parameter for all graph tools. */
const environmentParam = z
  .string()
  .optional()
  .describe("Environment name. If omitted, uses the default environment.");

// Tool 1: graph_stats
server.tool(
  "graph_stats",
  "Returns aggregate statistics about the ADF dependency graph (node/edge counts by type, build time, staleness).",
  { environment: environmentParam },
  async ({ environment }) => {
    const build = manager.ensureGraph(environment);
    const envName = environment ?? manager.getDefaultEnvironment();
    const envInfo = manager.listEnvironments().find((e) => e.name === envName);
    const result = handleStats(
      build.graph,
      envInfo?.lastBuild ?? null,
      envInfo?.isStale ?? true,
      build.warnings,
    );
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 2: graph_find_consumers
server.tool(
  "graph_find_consumers",
  "Find all pipeline activities that consume a given dataset, table, stored procedure, or Dataverse entity.",
  {
    target: z.string().describe("Name of the target artifact (e.g. 'businessunit')"),
    target_type: z
      .enum(["pipeline", "activity", "dataset", "stored_procedure", "table", "dataverse_entity", "linked_service", "key_vault_secret"])
      .describe("Node type of the target"),
    environment: environmentParam,
  },
  async ({ target, target_type, environment }) => {
    const build = manager.ensureGraph(environment);
    const result = handleFindConsumers(build.graph, target, target_type);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 3: graph_describe_pipeline
server.tool(
  "graph_describe_pipeline",
  "Describe a pipeline: summary, activities, or full detail including column mappings. Optionally filter to a single named activity.",
  {
    pipeline: z.string().describe("Pipeline name"),
    depth: z
      .enum(["summary", "activities", "full"])
      .default("summary")
      .describe("Level of detail to return"),
    activity: z.string().optional().describe("Optional activity name — returns full detail for just that activity"),
    environment: environmentParam,
  },
  async ({ pipeline, depth, activity, environment }) => {
    const build = manager.ensureGraph(environment);
    const result = handleDescribePipeline(build.graph, pipeline, depth, activity);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 4: graph_impact_analysis
server.tool(
  "graph_impact_analysis",
  "Analyse which nodes are affected if a given artifact changes. Traverses upstream, downstream, or both.",
  {
    target: z.string().describe("Name of the artifact to analyse"),
    target_type: z
      .enum(["pipeline", "activity", "dataset", "stored_procedure", "table", "dataverse_entity", "linked_service", "key_vault_secret"])
      .describe("Node type of the target"),
    direction: z
      .enum(["upstream", "downstream", "both"])
      .default("both")
      .describe("Traversal direction"),
    environment: environmentParam,
  },
  async ({ target, target_type, direction, environment }) => {
    const build = manager.ensureGraph(environment);
    const result = handleImpactAnalysis(build.graph, target, target_type, direction);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 5: graph_data_lineage
server.tool(
  "graph_data_lineage",
  "Trace data lineage for a Dataverse entity or staging table. Optionally filter to a single attribute/column.",
  {
    entity: z.string().describe("Entity or table name (e.g. 'businessunit')"),
    attribute: z
      .string()
      .optional()
      .describe("Optional attribute/column name for column-level lineage"),
    direction: z
      .enum(["upstream", "downstream"])
      .describe("'upstream' = what feeds this node; 'downstream' = what this node feeds"),
    maxDepth: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Maximum traversal depth (hops). Omit for unlimited."),
    environment: environmentParam,
  },
  async ({ entity, attribute, direction, maxDepth, environment }) => {
    const build = manager.ensureGraph(environment);
    const result = handleDataLineage(build.graph, entity, attribute, direction, maxDepth);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 6: graph_find_paths
server.tool(
  "graph_find_paths",
  "Find all dependency paths between two nodes in the graph.",
  {
    from: z.string().describe("Source node name"),
    to: z.string().describe("Target node name"),
    from_type: z.string().optional().describe("Node type of the source (e.g. 'pipeline')"),
    to_type: z.string().optional().describe("Node type of the target (e.g. 'dataverse_entity')"),
    environment: environmentParam,
  },
  async ({ from, to, from_type, to_type, environment }) => {
    const build = manager.ensureGraph(environment);
    const result = handleFindPaths(build.graph, from, to, from_type, to_type);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 7: graph_search_queries
server.tool(
  "graph_search_queries",
  "Search across activity SQL, FetchXML, stored procedure names/parameters, and ExecutePipeline parameter values for a text pattern (case-insensitive).",
  {
    query: z.string().min(1).describe("Text to search for (case-insensitive substring match)"),
    environment: environmentParam,
  },
  async ({ query, environment }) => {
    const build = manager.ensureGraph(environment);
    const result = handleSearchQueries(build.graph, query);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 8: graph_diff_pipeline
server.tool(
  "graph_diff_pipeline",
  "Compare a pipeline's structure across two environments. Shows added/removed/modified activities, SQL changes, and column mapping differences.",
  {
    pipeline: z.string().describe("Pipeline name to compare"),
    envA: z.string().describe("First environment name"),
    envB: z.string().describe("Second environment name"),
  },
  async ({ pipeline, envA, envB }) => {
    const buildA = manager.ensureGraph(envA);
    const buildB = manager.ensureGraph(envB);
    const result = handleDiffPipeline(buildA.graph, buildB.graph, pipeline, envA, envB);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 9: graph_deploy_readiness
server.tool(
  "graph_deploy_readiness",
  "Pre-flight check: walks the full dependency tree of a pipeline and reports what artifacts are present, stub (referenced but no file), or missing in the target environment. Also flags parameters with empty/null defaults that no parent supplies.",
  {
    pipeline: z.string().describe("Root pipeline name to check"),
    environment: environmentParam,
  },
  async ({ pipeline, environment }) => {
    const build = manager.ensureGraph(environment);
    const result = handleDeployReadiness(build.graph, pipeline);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 10: graph_trace_parameters
server.tool(
  "graph_trace_parameters",
  "Trace parameter flow through ExecutePipeline chains from a root pipeline. Maps each parameter from source to sink and flags dead-ends: parameters with empty/null defaults that no caller supplies a value for.",
  {
    pipeline: z.string().describe("Root pipeline name to trace from"),
    environment: environmentParam,
  },
  async ({ pipeline, environment }) => {
    const build = manager.ensureGraph(environment);
    const result = handleTraceParameters(build.graph, pipeline);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 11: graph_list_environments
server.tool(
  "graph_list_environments",
  "List all configured environments with their paths, default status, and graph statistics (node/edge counts, last build time, staleness).",
  {},
  async () => {
    const result = manager.listEnvironments();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 12: graph_add_overlay
server.tool(
  "graph_add_overlay",
  "Add an overlay path (directory or file) to an environment. The overlay's artifacts are merged on top of the base graph in a separate merged view. Runtime overlays are ephemeral (lost on restart).",
  {
    environment: z.string().describe("Base environment name to overlay onto"),
    path: z.string().describe("Path to overlay directory or file"),
  },
  async ({ environment, path }) => {
    const result = handleAddOverlay(manager, environment, path);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 13: graph_remove_overlay
server.tool(
  "graph_remove_overlay",
  "Remove a runtime overlay from an environment. Config-based overlays cannot be removed via this tool.",
  {
    environment: z.string().describe("Environment name"),
    path: z.string().describe("Overlay path to remove"),
  },
  async ({ environment, path }) => {
    const result = handleRemoveOverlay(manager, environment, path);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 14: graph_list_overlays
server.tool(
  "graph_list_overlays",
  "List all overlays (config-based and runtime) for an environment.",
  {
    environment: z.string().describe("Environment name"),
  },
  async ({ environment }) => {
    const result = handleListOverlays(manager, environment);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 15: graph_add_environment
server.tool(
  "graph_add_environment",
  "Register a new ephemeral environment pointing to an ADF artifact directory. Lost on server restart. Cannot collide with config-based environment names.",
  {
    name: z.string().describe("Environment name (cannot contain '+')"),
    path: z.string().describe("Path to ADF artifact root directory"),
    overlays: z
      .array(z.string())
      .optional()
      .describe("Optional overlay paths to apply to this environment"),
  },
  async ({ name, path, overlays }) => {
    const result = handleAddEnvironment(manager, name, path, overlays);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 16: graph_remove_environment
server.tool(
  "graph_remove_environment",
  "Remove a runtime environment. Config-based environments cannot be removed via this tool.",
  {
    name: z.string().describe("Environment name to remove"),
  },
  async ({ name }) => {
    const result = handleRemoveEnvironment(manager, name);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 17: graph_find_orchestrators
server.tool(
  "graph_find_orchestrators",
  "Find root orchestrator pipelines that own a given pipeline. Returns full ancestry chains with depth.",
  {
    pipeline: z.string().describe("Pipeline name to trace ancestry for"),
    environment: environmentParam,
  },
  async ({ pipeline, environment }) => {
    const build = manager.ensureGraph(environment);
    const result = handleFindOrchestrators(build.graph, pipeline);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 18: graph_diff_environments
server.tool(
  "graph_diff_environments",
  "Compare pipelines across two environments. Returns added/removed/changed pipelines with summary-level diffs.",
  {
    envA: z.string().describe("First environment name"),
    envB: z.string().describe("Second environment name"),
    scope: z.enum(["pipelines", "all"]).default("pipelines").describe("What to compare: pipelines only or all artifact types"),
  },
  async ({ envA, envB, scope }) => {
    const result = handleDiffEnvironments(manager, envA, envB, scope);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 19: graph_validate
server.tool(
  "graph_validate",
  "Run graph-wide validation: broken references, empty-default parameters without suppliers, unused datasets, orphaned nodes. Returns errors and warnings.",
  {
    environment: environmentParam,
    severity: z.enum(["all", "error", "warning"]).default("all").describe("Filter by severity"),
  },
  async ({ environment, severity }) => {
    const build = manager.ensureGraph(environment);
    const envName = environment ?? manager.getDefaultEnvironment();
    const result = handleValidate(build.graph, envName, severity);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 20: graph_search
server.tool(
  "graph_search",
  "Flexible search across the graph with optional filters for activity type, node type, target entity, and pipeline scope. Supports summary and full detail modes.",
  {
    query: z.string().min(1).describe("Search text (case-insensitive substring match)"),
    activityType: z.string().optional().describe("Filter to activities of this type (e.g. 'Copy', 'ExecutePipeline')"),
    nodeType: z.string().optional().describe("Filter to this node type (e.g. 'pipeline', 'dataset')"),
    targetEntity: z.string().optional().describe("Filter to activities that reference this entity/table"),
    pipeline: z.string().optional().describe("Filter to activities within this pipeline"),
    detail: z.enum(["summary", "full"]).default("summary").describe("Level of detail per hit"),
    environment: environmentParam,
  },
  async ({ query, activityType, nodeType, targetEntity, pipeline, detail, environment }) => {
    const build = manager.ensureGraph(environment);
    const result = handleEnhancedSearch(build.graph, query, { activityType, nodeType, targetEntity, pipeline, detail });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
