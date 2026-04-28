import { Graph, EdgeType, NodeType } from "../graph/model.js";
import { lookupPipelineNode } from "./toolUtils.js";
import { parseActivityId } from "../utils/nodeId.js";

export interface ConnectionChainStep {
  nodeType: string;
  name: string;
  edgeType: string;
  metadata: Record<string, unknown>;
}

export interface ConnectionChain {
  pipeline: string;
  activity: string;
  activityType: string;
  steps: ConnectionChainStep[];
}

export interface TraceConnectionResult {
  pipeline: string;
  activity?: string;
  chains: ConnectionChain[];
  error?: string;
}

export function handleTraceConnection(
  graph: Graph,
  pipeline: string,
  activity?: string,
): TraceConnectionResult {
  const lookup = lookupPipelineNode(graph, pipeline);
  if (lookup.error !== undefined) {
    return { pipeline, activity, chains: [], error: lookup.error };
  }

  const pipelineId = lookup.id;
  const containsEdges = graph.getOutgoing(pipelineId).filter((e) => e.type === EdgeType.Contains);

  const chains: ConnectionChain[] = [];

  for (const containsEdge of containsEdges) {
    const actNode = graph.getNode(containsEdge.to);
    if (!actNode) continue;

    const { activity: actName } = parseActivityId(actNode.id);
    if (activity && actName !== activity) continue;

    const actType = (actNode.metadata.activityType as string) ?? "unknown";
    const steps: ConnectionChainStep[] = [];

    const datasetEdges = graph.getOutgoing(actNode.id).filter((e) => e.type === EdgeType.UsesDataset);
    for (const dsEdge of datasetEdges) {
      const dsNode = graph.getNode(dsEdge.to);
      if (!dsNode) continue;

      steps.push({
        nodeType: dsNode.type,
        name: dsNode.name,
        edgeType: dsEdge.type,
        metadata: dsNode.metadata,
      });

      const lsEdges = graph.getOutgoing(dsNode.id).filter((e) => e.type === EdgeType.UsesLinkedService);
      for (const lsEdge of lsEdges) {
        appendLinkedServiceChain(graph, lsEdge.to, lsEdge.type, steps);
      }
    }

    const directLsEdges = graph.getOutgoing(actNode.id).filter((e) => e.type === EdgeType.UsesLinkedService);
    for (const lsEdge of directLsEdges) {
      appendLinkedServiceChain(graph, lsEdge.to, lsEdge.type, steps);
    }

    if (steps.length > 0) {
      chains.push({ pipeline, activity: actName, activityType: actType, steps });
    }
  }

  if (activity && chains.length === 0) {
    return { pipeline, activity, chains: [], error: `Activity '${activity}' not found in pipeline '${pipeline}'` };
  }

  return { pipeline, activity, chains };
}

function appendLinkedServiceChain(
  graph: Graph,
  lsNodeId: string,
  edgeType: string,
  steps: ConnectionChainStep[],
): void {
  const lsNode = graph.getNode(lsNodeId);
  if (!lsNode) return;

  steps.push({
    nodeType: lsNode.type,
    name: lsNode.name,
    edgeType,
    metadata: lsNode.metadata,
  });

  const secretEdges = graph.getOutgoing(lsNodeId).filter((e) => e.type === EdgeType.ReferencesSecret);
  for (const secEdge of secretEdges) {
    const secNode = graph.getNode(secEdge.to);
    if (!secNode) continue;
    steps.push({
      nodeType: secNode.type,
      name: secNode.name,
      edgeType: secEdge.type,
      metadata: secNode.metadata,
    });
  }

  const vaultEdges = graph.getOutgoing(lsNodeId).filter((e) => e.type === EdgeType.UsesLinkedService);
  for (const vaultEdge of vaultEdges) {
    const vaultNode = graph.getNode(vaultEdge.to);
    if (!vaultNode) continue;
    steps.push({
      nodeType: vaultNode.type,
      name: vaultNode.name,
      edgeType: vaultEdge.type,
      metadata: vaultNode.metadata,
    });
  }
}
