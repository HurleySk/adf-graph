import { GraphNode, GraphEdge } from "../../graph/model.js";
import { ActivityContext } from "./base.js";

export interface ContainerParseResult {
  innerNodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
}

type ParseActivityFn = (
  activity: Record<string, unknown>,
  context: ActivityContext,
) => { node: GraphNode; innerNodes?: GraphNode[]; edges: GraphEdge[]; warnings: string[] };

const CONTAINER_TYPES: Record<string, string[]> = {
  Until: ["activities"],
  ForEach: ["activities"],
  IfCondition: ["ifTrueActivities", "ifFalseActivities"],
};

export function parseContainerActivity(
  activity: Record<string, unknown>,
  containerNode: GraphNode,
  context: ActivityContext,
  parseActivityFn: ParseActivityFn,
): ContainerParseResult {
  const innerNodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  const activityType = activity.type as string;
  const containerName = activity.name as string;
  const typeProperties = activity.typeProperties as Record<string, unknown> | undefined;
  if (!typeProperties) return { innerNodes, edges, warnings };

  const propertyKeys = CONTAINER_TYPES[activityType];
  if (!propertyKeys) return { innerNodes, edges, warnings };

  const newPrefix = `${context.containerPrefix ?? ""}${containerName}/`;
  const innerContext: ActivityContext = {
    pipelineId: context.pipelineId,
    pipelineName: context.pipelineName,
    containerPrefix: newPrefix,
    containerId: containerNode.id,
  };

  for (const key of propertyKeys) {
    const innerActivities = (typeProperties[key] as unknown[]) ?? [];
    for (const inner of innerActivities) {
      const innerActivity = inner as Record<string, unknown>;
      const result = parseActivityFn(innerActivity, innerContext);
      innerNodes.push(result.node);
      if (result.innerNodes) {
        innerNodes.push(...result.innerNodes);
      }
      edges.push(...result.edges);
      warnings.push(...result.warnings);
    }
  }

  return { innerNodes, edges, warnings };
}

export function isContainerType(activityType: string): boolean {
  return activityType in CONTAINER_TYPES;
}
