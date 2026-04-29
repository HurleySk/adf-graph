import { Graph, GraphNode, NodeType, EdgeType } from "../graph/model.js";
import { makeNodeId } from "../utils/nodeId.js";
import { asString } from "../utils/expressionValue.js";

export interface PipelineLookupSuccess {
  node: GraphNode;
  id: string;
  error: undefined;
}

export interface PipelineLookupFailure {
  node: undefined;
  id: string;
  error: string;
}

export type PipelineLookupResult = PipelineLookupSuccess | PipelineLookupFailure;

export function lookupPipelineNode(graph: Graph, pipeline: string): PipelineLookupResult {
  const id = makeNodeId(NodeType.Pipeline, pipeline);
  const node = graph.getNode(id);
  if (!node) {
    return { node: undefined, id, error: `Pipeline '${pipeline}' not found` };
  }
  return { node, id, error: undefined };
}

export function resolveEntityName(
  graph: Graph,
  activityNode: GraphNode,
): string | null {
  const params = activityNode.metadata.pipelineParameters as Record<string, unknown> | undefined;
  if (params) {
    const entityName = asString(params.dataverse_entity_name);
    if (entityName && !entityName.startsWith("@")) {
      return entityName;
    }
  }

  const outgoing = graph.getOutgoing(activityNode.id);
  for (const edge of outgoing) {
    if (edge.type !== EdgeType.Executes) continue;
    const childPipeline = graph.getNode(edge.to);
    if (!childPipeline) continue;

    const childEdges = graph.getOutgoing(edge.to);
    for (const childEdge of childEdges) {
      if (childEdge.type !== EdgeType.Contains) continue;
      const childActivity = graph.getNode(childEdge.to);
      if (!childActivity || childActivity.type !== NodeType.Activity) continue;

      const actEdges = graph.getOutgoing(childActivity.id);
      for (const actEdge of actEdges) {
        if (actEdge.type === EdgeType.WritesTo && actEdge.to.startsWith("dataverse_entity:")) {
          return actEdge.to.replace("dataverse_entity:", "");
        }
      }
    }
  }

  return null;
}
