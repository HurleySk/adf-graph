import { Graph, GraphNode, NodeType, EdgeType } from "../graph/model.js";
import { makeNodeId, makeEntityId, makePipelineId } from "../utils/nodeId.js";
import { asNonDynamic } from "../utils/expressionValue.js";
import { loadEntityDetail } from "../parsers/dataverseSchema.js";
import { getParameterDefs } from "../graph/nodeMetadata.js";

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
  const id = makePipelineId(pipeline);
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
    const entityName = asNonDynamic(params.dataverse_entity_name);
    if (entityName) {
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

export function getEntityAttributes(
  graph: Graph,
  entityName: string,
  schemaPath?: string,
): Set<string> | null {
  const entityNodeId = makeEntityId(entityName);
  const entityNode = graph.getNode(entityNodeId);
  if (!entityNode) return null;

  const attrs = new Set<string>();

  const outgoing = graph.getOutgoing(entityNodeId);
  for (const edge of outgoing) {
    if (edge.type !== EdgeType.HasAttribute) continue;
    const attrNode = graph.getNode(edge.to);
    if (attrNode) {
      const name = attrNode.name.includes(".") ? attrNode.name.split(".").pop()! : attrNode.name;
      attrs.add(name.toLowerCase());
    }
  }

  if (schemaPath && entityNode.metadata.schemaFile) {
    const detail = loadEntityDetail(schemaPath, entityNode.metadata.schemaFile as string);
    if (detail) {
      for (const attr of detail.attributes) {
        attrs.add(attr.logicalName.toLowerCase());
      }
    }
  }

  return attrs;
}

export function getWrittenEntity(graph: Graph, activityId: string): string | null {
  for (const edge of graph.getOutgoing(activityId)) {
    if (edge.type === EdgeType.WritesTo && edge.to.startsWith("dataverse_entity:")) {
      return edge.to.replace(`${NodeType.DataverseEntity}:`, "");
    }
  }
  return null;
}

export interface DestQueryDefaults {
  destQuery: string;
  entityName: string;
  pipelineName: string;
  pipelineId: string;
}

export function resolveDestQueryDefaults(
  pipelineNode: GraphNode,
): DestQueryDefaults | null {
  const paramDefs = getParameterDefs(pipelineNode);
  const destQueryParam = paramDefs.find((p) => p.name === "dest_query");
  const destQueryDefault = asNonDynamic(destQueryParam?.defaultValue);
  if (!destQueryDefault) return null;

  const entityParam = paramDefs.find((p) => p.name === "dataverse_entity_name");
  const entityDefault = asNonDynamic(entityParam?.defaultValue);
  if (!entityDefault) return null;

  return {
    destQuery: destQueryDefault,
    entityName: entityDefault,
    pipelineName: pipelineNode.name,
    pipelineId: pipelineNode.id,
  };
}
