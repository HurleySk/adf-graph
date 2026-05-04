import { GraphNode, GraphEdge, NodeType } from "../graph/model.js";
import { ParseResult } from "./parseResult.js";
import { makeIntegrationRuntimeId } from "../utils/nodeId.js";

export function parseIntegrationRuntimeFile(json: unknown): ParseResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  if (!json || typeof json !== "object") {
    warnings.push("Invalid integration runtime JSON: not an object");
    return { nodes, edges, warnings };
  }

  const root = json as Record<string, unknown>;
  const name = root.name as string;
  const properties = root.properties as Record<string, unknown> | undefined;

  if (!name || !properties) {
    warnings.push("Integration runtime missing name or properties");
    return { nodes, edges, warnings };
  }

  const irType = properties.type as string | undefined;
  const description = properties.description as string | undefined;
  const typeProperties = properties.typeProperties as Record<string, unknown> | undefined;
  const managedVirtualNetwork = properties.managedVirtualNetwork as Record<string, unknown> | undefined;

  let computeProperties: Record<string, unknown> | undefined;
  if (typeProperties?.computeProperties) {
    const cp = typeProperties.computeProperties as Record<string, unknown>;
    computeProperties = {
      location: cp.location ?? null,
    };
    const dfProps = cp.dataFlowProperties as Record<string, unknown> | undefined;
    if (dfProps) {
      (computeProperties as Record<string, unknown>).coreCount = dfProps.coreCount ?? null;
      (computeProperties as Record<string, unknown>).timeToLive = dfProps.timeToLive ?? null;
      (computeProperties as Record<string, unknown>).computeType = dfProps.computeType ?? null;
    }
    const pipelineProps = cp.pipelineExternalComputeScaleProperties as Record<string, unknown> | undefined;
    if (pipelineProps?.timeToLive) {
      (computeProperties as Record<string, unknown>).pipelineTimeToLive = pipelineProps.timeToLive;
    }
  }

  const irId = makeIntegrationRuntimeId(name);
  nodes.push({
    id: irId,
    type: NodeType.IntegrationRuntime,
    name,
    metadata: {
      irType: irType ?? null,
      ...(description ? { description } : {}),
      ...(computeProperties ? { computeProperties } : {}),
      ...(managedVirtualNetwork ? { managedVirtualNetwork: managedVirtualNetwork.referenceName ?? null } : {}),
    },
  });

  return { nodes, edges, warnings };
}
