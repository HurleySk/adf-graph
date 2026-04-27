import { GraphNode, GraphEdge, NodeType, EdgeType } from "../../graph/model.js";

export interface ActivityContext {
  pipelineId: string;
  pipelineName: string;
}

export interface ActivityParseResult {
  node: GraphNode;
  edges: GraphEdge[];
  warnings: string[];
}

/**
 * Create the base activity node and its standard edges:
 *   - Contains edge (pipeline -> activity)
 *   - DependsOn edges (activity -> dependency activities)
 */
export function parseBaseActivity(
  activity: Record<string, unknown>,
  context: ActivityContext,
): ActivityParseResult {
  const activityName = activity.name as string;
  const activityType = activity.type as string;
  const activityId = `${NodeType.Activity}:${context.pipelineName}/${activityName}`;

  const node: GraphNode = {
    id: activityId,
    type: NodeType.Activity,
    name: activityName,
    metadata: { activityType },
  };

  const edges: GraphEdge[] = [];

  // Pipeline -> Activity (contains)
  edges.push({
    from: context.pipelineId,
    to: activityId,
    type: EdgeType.Contains,
    metadata: {},
  });

  // dependsOn edges (activity -> activity)
  const dependsOn = (activity.dependsOn as unknown[]) ?? [];
  for (const dep of dependsOn) {
    const d = dep as Record<string, unknown>;
    const depName = d.activity as string;
    const depId = `${NodeType.Activity}:${context.pipelineName}/${depName}`;
    edges.push({
      from: activityId,
      to: depId,
      type: EdgeType.DependsOn,
      metadata: {},
    });
  }

  return { node, edges, warnings: [] };
}
