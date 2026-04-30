import { Graph, NodeType, EdgeType, type GraphEdge } from "../graph/model.js";
import { ParameterDef, getParameterDefs, getActivityType, getActivityMetadata } from "../graph/nodeMetadata.js";
import { parseNodeId } from "../utils/nodeId.js";
import { lookupPipelineNode, resolveDatasetLinkedServices } from "./toolUtils.js";
import { resolveChildParameters, type ResolvedChildPipeline } from "../utils/parameterResolver.js";

export type DescribeDepth = "summary" | "activities" | "full" | "resolved";

export interface ConnectionInfo {
  datasetName: string;
  linkedServiceName: string;
  linkedServiceType: string;
  connectionProperties: Record<string, string>;
}

export interface ActivityInfo {
  name: string;
  activityType: string;
  dependsOn: string[];
  parentActivity?: string;
  sources?: string[];
  sinks?: string[];
  sourceConnections?: ConnectionInfo[];
  sinkConnections?: ConnectionInfo[];
  columnMappings?: Array<{ sourceColumn: string | null; sinkColumn: string | null }>;
  sqlQuery?: string;
  fetchXmlQuery?: string;
  storedProcedureName?: string;
  storedProcedureParameters?: Record<string, unknown>;
  pipelineParameters?: Record<string, unknown>;
  resolvedChild?: ResolvedChildPipeline;
}

export { ParameterDef } from "../graph/nodeMetadata.js";

export interface PipelineSummary {
  name: string;
  parameters: ParameterDef[];
  childPipelines: string[];
  rootOrchestrators: string[];
}

export interface DescribePipelineResult {
  pipeline: string;
  summary: PipelineSummary;
  activities?: ActivityInfo[];
  error?: string;
}

/**
 * Describe a pipeline at the requested depth:
 * - "summary": name, parameters, childPipelines, rootOrchestrators
 * - "activities": adds activity DAG with types and dependsOn
 * - "full": adds sources, sinks, and column mappings per activity
 */
export function handleDescribePipeline(
  graph: Graph,
  pipeline: string,
  depth: DescribeDepth = "summary",
  activity?: string,
): DescribePipelineResult {
  const lookup = lookupPipelineNode(graph, pipeline);
  if (lookup.error !== undefined) {
    return {
      pipeline,
      summary: { name: pipeline, parameters: [], childPipelines: [], rootOrchestrators: [] },
      error: `Pipeline '${pipeline}' not found in graph`,
    };
  }
  const pipelineId = lookup.id;
  const pipelineNode = lookup.node;

  // Child pipelines: outgoing executes edges
  const outgoing = graph.getOutgoing(pipelineId);
  const childPipelines = outgoing
    .filter((e) => e.type === EdgeType.Executes)
    .map((e) => parseNodeId(e.to).name);

  // Root orchestrators: traverse upstream, find pipelines with no incoming executes
  const upstream = graph.traverseUpstream(pipelineId);
  const rootOrchestrators: string[] = [];
  for (const result of upstream) {
    if (result.node.type !== NodeType.Pipeline) continue;
    const incomingExecutes = graph.getIncoming(result.node.id).filter(
      (e) => e.type === EdgeType.Executes,
    );
    if (incomingExecutes.length === 0) {
      rootOrchestrators.push(result.node.name);
    }
  }
  // Also check if the pipeline itself is a root
  const selfIncoming = graph.getIncoming(pipelineId).filter(
    (e) => e.type === EdgeType.Executes,
  );
  if (selfIncoming.length === 0 && !rootOrchestrators.includes(pipeline)) {
    rootOrchestrators.unshift(pipeline);
  }

  const parameters = getParameterDefs(pipelineNode);

  const summary: PipelineSummary = {
    name: pipeline,
    parameters,
    childPipelines,
    rootOrchestrators,
  };

  const result: DescribePipelineResult = { pipeline, summary };

  if (depth === "summary" && !activity) {
    return result;
  }

  const effectiveDepth = activity ? "full" : (depth === "resolved" ? "resolved" : depth);

  // Recursively collect activities through the Contains tree
  function collectActivities(parentId: string, parentName?: string): ActivityInfo[] {
    const parentOutgoing = graph.getOutgoing(parentId);
    const containedEdges = parentOutgoing.filter((e) => e.type === EdgeType.Contains);
    const collected: ActivityInfo[] = [];

    for (const containsEdge of containedEdges) {
      const activityNode = graph.getNode(containsEdge.to);
      if (!activityNode || activityNode.type !== NodeType.Activity) continue;

      const activityType = getActivityType(activityNode);

      const actOutgoing = graph.getOutgoing(activityNode.id);
      const dependsOn = actOutgoing
        .filter((e) => e.type === EdgeType.DependsOn)
        .map((e) => {
          const depNode = graph.getNode(e.to);
          return depNode ? depNode.name : e.to.slice(e.to.lastIndexOf("/") + 1);
        });

      const activityInfo: ActivityInfo = {
        name: activityNode.name,
        activityType,
        dependsOn,
      };

      if (parentName) {
        activityInfo.parentActivity = parentName;
      }

      if (effectiveDepth === "full" || effectiveDepth === "resolved") {
        const sources = actOutgoing
          .filter((e) => e.type === EdgeType.ReadsFrom ||
            (e.type === EdgeType.UsesDataset && e.metadata.direction === "input"))
          .map((e) => e.to);

        const sinks = actOutgoing
          .filter((e) => e.type === EdgeType.WritesTo ||
            (e.type === EdgeType.UsesDataset && e.metadata.direction === "output"))
          .map((e) => e.to);

        const colMappings = actOutgoing
          .filter((e) => e.type === EdgeType.MapsColumn)
          .map((e) => ({
            sourceColumn: (e.metadata.sourceColumn as string | null) ?? null,
            sinkColumn: (e.metadata.sinkColumn as string | null) ?? null,
          }));

        activityInfo.sources = sources;
        activityInfo.sinks = sinks;
        activityInfo.columnMappings = colMappings;

        const srcConns = resolveConnectionInfo(graph, actOutgoing, "input");
        const snkConns = resolveConnectionInfo(graph, actOutgoing, "output");
        if (srcConns.length > 0) activityInfo.sourceConnections = srcConns;
        if (snkConns.length > 0) activityInfo.sinkConnections = snkConns;
        const meta = getActivityMetadata(activityNode);
        if (meta.sqlQuery) activityInfo.sqlQuery = meta.sqlQuery;
        if (meta.fetchXmlQuery) activityInfo.fetchXmlQuery = meta.fetchXmlQuery;
        if (meta.storedProcedureName) activityInfo.storedProcedureName = meta.storedProcedureName;
        if (meta.storedProcedureParameters) activityInfo.storedProcedureParameters = meta.storedProcedureParameters;
        if (meta.pipelineParameters) activityInfo.pipelineParameters = meta.pipelineParameters;

        if (effectiveDepth === "resolved" && meta.pipelineParameters && meta.executedPipeline) {
          const resolved = resolveChildParameters(graph, activityNode);
          if (resolved) activityInfo.resolvedChild = resolved;
        }
      }

      collected.push(activityInfo);

      // Recurse into container activities
      const innerActivities = collectActivities(activityNode.id, activityNode.name);
      collected.push(...innerActivities);
    }

    return collected;
  }

  const activities = collectActivities(pipelineId);

  if (activity) {
    const filtered = activities.filter((a) => a.name === activity);
    if (filtered.length === 0) {
      result.error = `Activity '${activity}' not found in pipeline '${pipeline}'`;
      result.activities = [];
      return result;
    }
    result.activities = filtered;
  } else {
    result.activities = activities;
  }

  return result;
}

function resolveConnectionInfo(
  graph: Graph,
  actOutgoing: GraphEdge[],
  direction: "input" | "output",
): ConnectionInfo[] {
  const dsIds = actOutgoing
    .filter((e) => e.type === EdgeType.UsesDataset && e.metadata.direction === direction)
    .map((e) => e.to);
  return resolveDatasetLinkedServices(graph, dsIds).map((ls) => ({
    datasetName: ls.datasetName,
    linkedServiceName: ls.lsName,
    linkedServiceType: ls.lsType,
    connectionProperties: ls.connectionProperties,
  }));
}
