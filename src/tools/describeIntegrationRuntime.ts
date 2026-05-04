import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { makeIntegrationRuntimeId } from "../utils/nodeId.js";

interface IntegrationRuntimeInfo {
  name: string;
  type: string;
  description?: string;
  computeProperties?: Record<string, unknown>;
  managedVirtualNetwork?: string;
  linkedServices: string[];
}

export interface DescribeIntegrationRuntimeResult {
  integrationRuntimes: IntegrationRuntimeInfo[];
  error?: string;
}

export function handleDescribeIntegrationRuntime(
  graph: Graph,
  ir?: string,
): DescribeIntegrationRuntimeResult {
  if (ir) {
    const irId = makeIntegrationRuntimeId(ir);
    const node = graph.getNode(irId);
    if (!node) {
      return { integrationRuntimes: [], error: `Integration runtime '${ir}' not found in graph` };
    }
    return { integrationRuntimes: [nodeToIrInfo(graph, node.id, node.name, node.metadata)] };
  }

  const allIrs = graph.getNodesByType(NodeType.IntegrationRuntime);
  const integrationRuntimes = allIrs.map(n => nodeToIrInfo(graph, n.id, n.name, n.metadata));
  return { integrationRuntimes };
}

function nodeToIrInfo(graph: Graph, id: string, name: string, metadata: Record<string, unknown>): IntegrationRuntimeInfo {
  const linkedServices: string[] = [];
  for (const edge of graph.getIncoming(id)) {
    if (edge.type === EdgeType.UsesIntegrationRuntime) {
      const lsNode = graph.getNode(edge.from);
      if (lsNode) linkedServices.push(lsNode.name);
    }
  }

  return {
    name,
    type: (metadata.irType as string) ?? "Unknown",
    ...(metadata.description ? { description: metadata.description as string } : {}),
    ...(metadata.computeProperties ? { computeProperties: metadata.computeProperties as Record<string, unknown> } : {}),
    ...(metadata.managedVirtualNetwork ? { managedVirtualNetwork: metadata.managedVirtualNetwork as string } : {}),
    linkedServices,
  };
}
