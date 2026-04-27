import { Graph, GraphNode, EdgeType } from "./model.js";
import { getActivityMetadata } from "./nodeMetadata.js";

/**
 * Find all ExecutePipeline activity nodes contained by the given pipeline.
 * Returns GraphNode[] of activity nodes whose activityType is "ExecutePipeline".
 */
export function findExecutePipelineActivities(graph: Graph, pipelineId: string): GraphNode[] {
  const containsEdges = graph.getOutgoing(pipelineId).filter((e) => e.type === EdgeType.Contains);
  return containsEdges
    .map((ce) => graph.getNode(ce.to))
    .filter((n): n is NonNullable<typeof n> => n !== undefined && getActivityMetadata(n).activityType === "ExecutePipeline");
}
