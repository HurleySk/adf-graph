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

export const CONTAINER_TYPES: Record<string, string[]> = {
  Until: ["activities"],
  ForEach: ["activities"],
  IfCondition: ["ifTrueActivities", "ifFalseActivities"],
  Switch: ["defaultActivities"],
};

/**
 * Every child activity nested directly inside a container activity.
 *
 * Most containers list their children under a fixed set of typeProperties keys
 * (see CONTAINER_TYPES). Switch is the exception: besides `defaultActivities`
 * it nests one activity array per case under `typeProperties.cases[].activities`.
 *
 * Returns an empty array for non-container activities.
 */
export function getNestedActivities(
  activity: Record<string, unknown>,
): Record<string, unknown>[] {
  const activityType = activity.type as string;
  const propertyKeys = CONTAINER_TYPES[activityType];
  if (!propertyKeys) return [];

  const typeProperties = activity.typeProperties as Record<string, unknown> | undefined;
  if (!typeProperties) return [];

  const nested: Record<string, unknown>[] = [];
  const push = (value: unknown): void => {
    if (Array.isArray(value)) nested.push(...(value as Record<string, unknown>[]));
  };

  if (activityType === "Switch") {
    const cases = typeProperties.cases;
    if (Array.isArray(cases)) {
      for (const c of cases) {
        push((c as Record<string, unknown> | null)?.activities);
      }
    }
  }

  for (const key of propertyKeys) {
    push(typeProperties[key]);
  }

  return nested;
}

export function parseContainerActivity(
  activity: Record<string, unknown>,
  containerNode: GraphNode,
  context: ActivityContext,
  parseActivityFn: ParseActivityFn,
): ContainerParseResult {
  const innerNodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  const containerName = activity.name as string;
  const nestedActivities = getNestedActivities(activity);
  if (nestedActivities.length === 0) return { innerNodes, edges, warnings };

  const newPrefix = `${context.containerPrefix ?? ""}${containerName}/`;
  const innerContext: ActivityContext = {
    pipelineId: context.pipelineId,
    pipelineName: context.pipelineName,
    containerPrefix: newPrefix,
    containerId: containerNode.id,
  };

  for (const innerActivity of nestedActivities) {
    const result = parseActivityFn(innerActivity, innerContext);
    innerNodes.push(result.node);
    if (result.innerNodes) {
      innerNodes.push(...result.innerNodes);
    }
    edges.push(...result.edges);
    warnings.push(...result.warnings);
  }

  return { innerNodes, edges, warnings };
}

export function isContainerType(activityType: string): boolean {
  return activityType in CONTAINER_TYPES;
}
