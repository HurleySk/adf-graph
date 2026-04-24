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

const transport = new StdioServerTransport();
await server.connect(transport);
