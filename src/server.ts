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
import { handleAddOverlay } from "./tools/addOverlay.js";
import { handleRemoveOverlay } from "./tools/removeOverlay.js";
import { handleListOverlays } from "./tools/listOverlays.js";
import { handleAddEnvironment } from "./tools/addEnvironment.js";
import { handleRemoveEnvironment } from "./tools/removeEnvironment.js";

const config = loadConfig();
const manager = new GraphManager(config);

const server = new McpServer({
  name: "adf-graph",
  version: "0.1.0",
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
      .enum(["pipeline", "activity", "dataset", "stored_procedure", "table", "dataverse_entity"])
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
  "Describe a pipeline: summary, activities, or full detail including column mappings.",
  {
    pipeline: z.string().describe("Pipeline name"),
    depth: z
      .enum(["summary", "activities", "full"])
      .default("summary")
      .describe("Level of detail to return"),
    environment: environmentParam,
  },
  async ({ pipeline, depth, environment }) => {
    const build = manager.ensureGraph(environment);
    const result = handleDescribePipeline(build.graph, pipeline, depth);
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
      .enum(["pipeline", "activity", "dataset", "stored_procedure", "table", "dataverse_entity"])
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
    environment: environmentParam,
  },
  async ({ entity, attribute, direction, environment }) => {
    const build = manager.ensureGraph(environment);
    const result = handleDataLineage(build.graph, entity, attribute, direction);
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

// Tool 7: graph_list_environments
server.tool(
  "graph_list_environments",
  "List all configured environments with their paths, default status, and graph statistics (node/edge counts, last build time, staleness).",
  {},
  async () => {
    const result = manager.listEnvironments();
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  },
);

// Tool 8: graph_add_overlay
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

// Tool 9: graph_remove_overlay
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

// Tool 10: graph_list_overlays
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

// Tool 11: graph_add_environment
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

// Tool 12: graph_remove_environment
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

const transport = new StdioServerTransport();
await server.connect(transport);
