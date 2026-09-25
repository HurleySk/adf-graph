import { getEntityMetadata } from "../graph/nodeMetadata.js";
import { getEntityDetail } from "./toolUtils.js";
import { Graph, EdgeType } from "../graph/model.js";
import { makeEntityId } from "../utils/nodeId.js";

interface AttributeSummary {
  name: string;
  type?: string;
  requiredLevel?: string;
  isValidForCreate?: boolean;
  isValidForUpdate?: boolean;
  displayName?: string;
  isCustomAttribute?: boolean;
}

interface Consumer {
  activityId: string;
  activityName: string;
  direction: "reads" | "writes";
}

export interface DescribeEntityResult {
  entity: string;
  displayName?: string;
  entitySetName?: string;
  primaryId?: string;
  primaryName?: string;
  attributeCount?: number;
  consumers: Consumer[];
  attributes: AttributeSummary[];
  error?: string;
}

export function handleDescribeEntity(
  graph: Graph,
  entity: string,
  depth: "summary" | "full",
  schemaPath?: string,
): DescribeEntityResult {
  const nodeId = makeEntityId(entity);
  const node = graph.getNode(nodeId);

  if (!node) {
    return { entity, consumers: [], attributes: [], error: `Entity '${entity}' not found in graph` };
  }

  // Find consumers: activities that read from or write to this entity
  const consumers: Consumer[] = [];
  const incoming = graph.getIncoming(nodeId);
  for (const edge of incoming) {
    if (edge.type === EdgeType.ReadsFrom || edge.type === EdgeType.WritesTo) {
      const actNode = graph.getNode(edge.from);
      consumers.push({
        activityId: edge.from,
        activityName: actNode?.name ?? edge.from,
        direction: edge.type === EdgeType.ReadsFrom ? "reads" : "writes",
      });
    }
  }

  // Get attributes from HasAttribute edges
  const attrEdges = graph.getOutgoing(nodeId, EdgeType.HasAttribute);
  let attributes: AttributeSummary[] = attrEdges.map((e) => {
    const attrNode = graph.getNode(e.to);
    const attrName = attrNode?.name.split(".").pop() ?? e.to.split(".").pop() ?? e.to;
    return { name: attrName };
  });

  // At full depth, enrich with per-entity file detail
  if (depth === "full") {
    const detail = getEntityDetail(graph, entity, schemaPath);
    if (detail) {
      attributes = detail.attributes.map((a) => ({
        name: a.logicalName,
        type: a.attributeType,
        requiredLevel: a.requiredLevel,
        isValidForCreate: a.isValidForCreate,
        isValidForUpdate: a.isValidForUpdate,
        displayName: a.displayName,
        isCustomAttribute: a.isCustomAttribute,
      }));
    }
  }

  const entityMeta = getEntityMetadata(node);
  return {
    entity,
    displayName: entityMeta.displayName,
    entitySetName: entityMeta.entitySetName,
    primaryId: entityMeta.primaryId,
    primaryName: entityMeta.primaryName,
    attributeCount: entityMeta.attributeCount,
    consumers,
    attributes,
  };
}
