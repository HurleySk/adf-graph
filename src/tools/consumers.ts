import { Graph, EdgeType } from "../graph/model.js";

export interface ConsumerEntry {
  pipeline: string;
  activity: string;
  usage: "reads" | "writes" | "calls" | "uses";
}

export interface FindConsumersResult {
  target: string;
  targetType: string;
  nodeId: string;
  consumers: ConsumerEntry[];
}

/**
 * Map an EdgeType to a human-readable usage label.
 */
function usageFromEdgeType(edgeType: EdgeType): ConsumerEntry["usage"] {
  switch (edgeType) {
    case EdgeType.ReadsFrom:
      return "reads";
    case EdgeType.WritesTo:
      return "writes";
    case EdgeType.CallsSp:
      return "calls";
    default:
      return "uses";
  }
}

/**
 * Given a target name and type, find all activities that consume it (via
 * incoming edges to the target node).  Each result shows the pipeline name,
 * activity name, and how it is used (reads / writes / calls / uses).
 */
export function handleFindConsumers(
  graph: Graph,
  target: string,
  targetType: string,
): FindConsumersResult {
  const nodeId = `${targetType}:${target}`;
  const incoming = graph.getIncoming(nodeId);

  const consumers: ConsumerEntry[] = [];

  for (const edge of incoming) {
    const fromNode = graph.getNode(edge.from);
    if (!fromNode) continue;

    // Activities have IDs like "activity:PipelineName/ActivityName"
    if (fromNode.type !== undefined && edge.from.startsWith("activity:")) {
      const parts = fromNode.name.includes("/")
        ? fromNode.name.split("/")
        : edge.from.slice("activity:".length).split("/");
      const pipelineName = parts[0];
      const activityName = parts.slice(1).join("/") || fromNode.name;
      consumers.push({
        pipeline: pipelineName,
        activity: activityName,
        usage: usageFromEdgeType(edge.type),
      });
    }
  }

  return {
    target,
    targetType,
    nodeId,
    consumers,
  };
}
