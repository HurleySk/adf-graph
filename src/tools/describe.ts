import { Graph, NodeType, EdgeType } from "../graph/model.js";

export type DescribeDepth = "summary" | "activities" | "full";

export interface ActivityInfo {
  name: string;
  activityType: string;
  dependsOn: string[];
  sources?: string[];
  sinks?: string[];
  columnMappings?: Array<{ sourceColumn: string | null; sinkColumn: string | null }>;
  sqlQuery?: string;
  fetchXmlQuery?: string;
  storedProcedureName?: string;
  storedProcedureParameters?: Record<string, unknown>;
  pipelineParameters?: Record<string, unknown>;
}

export interface ParameterDef {
  name: string;
  type: string;
  defaultValue: unknown;
}

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
): DescribePipelineResult {
  const pipelineId = `pipeline:${pipeline}`;
  const pipelineNode = graph.getNode(pipelineId);

  if (!pipelineNode) {
    return {
      pipeline,
      summary: { name: pipeline, parameters: [], childPipelines: [], rootOrchestrators: [] },
      error: `Pipeline '${pipeline}' not found in graph`,
    };
  }

  // Child pipelines: outgoing executes edges
  const outgoing = graph.getOutgoing(pipelineId);
  const childPipelines = outgoing
    .filter((e) => e.type === EdgeType.Executes)
    .map((e) => e.to.slice("pipeline:".length));

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

  // Parameters from metadata
  const parameters = (pipelineNode.metadata.parameters as ParameterDef[]) ?? [];

  const summary: PipelineSummary = {
    name: pipeline,
    parameters,
    childPipelines,
    rootOrchestrators,
  };

  const result: DescribePipelineResult = { pipeline, summary };

  if (depth === "summary") {
    return result;
  }

  // Build activity info
  const containedEdges = outgoing.filter((e) => e.type === EdgeType.Contains);
  const activities: ActivityInfo[] = [];

  for (const containsEdge of containedEdges) {
    const activityNode = graph.getNode(containsEdge.to);
    if (!activityNode) continue;

    const activityType = (activityNode.metadata.activityType as string) ?? "Unknown";

    // dependsOn: outgoing depends_on edges from this activity
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

    if (depth === "full") {
      // Sources: tables and datasets read by this activity
      const sources = actOutgoing
        .filter((e) => e.type === EdgeType.ReadsFrom || (e.type === EdgeType.UsesDataset && e.to.startsWith("dataset:")))
        .map((e) => e.to);

      // Sinks: tables, DV entities, datasets written by this activity
      const sinks = actOutgoing
        .filter((e) => e.type === EdgeType.WritesTo)
        .map((e) => e.to);

      // Column mappings: self-edges with MapsColumn
      const colMappings = actOutgoing
        .filter((e) => e.type === EdgeType.MapsColumn)
        .map((e) => ({
          sourceColumn: (e.metadata.sourceColumn as string | null) ?? null,
          sinkColumn: (e.metadata.sinkColumn as string | null) ?? null,
        }));

      activityInfo.sources = sources;
      activityInfo.sinks = sinks;
      activityInfo.columnMappings = colMappings;
      if (activityNode.metadata.sqlQuery) {
        activityInfo.sqlQuery = activityNode.metadata.sqlQuery as string;
      }
      if (activityNode.metadata.fetchXmlQuery) {
        activityInfo.fetchXmlQuery = activityNode.metadata.fetchXmlQuery as string;
      }
      if (activityNode.metadata.storedProcedureName) {
        activityInfo.storedProcedureName = activityNode.metadata.storedProcedureName as string;
      }
      if (activityNode.metadata.storedProcedureParameters) {
        activityInfo.storedProcedureParameters = activityNode.metadata.storedProcedureParameters as Record<string, unknown>;
      }
      if (activityNode.metadata.pipelineParameters) {
        activityInfo.pipelineParameters = activityNode.metadata.pipelineParameters as Record<string, unknown>;
      }
    }

    activities.push(activityInfo);
  }

  result.activities = activities;
  return result;
}
