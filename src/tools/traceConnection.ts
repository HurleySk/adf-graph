import { Graph, EdgeType } from "../graph/model.js";
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

  const chains: ConnectionChain[] = [];
  const visitedPipelines = new Set<string>([lookup.id]);

  collectChains(graph, lookup.id, pipeline, activity, chains, visitedPipelines);

  if (activity && chains.length === 0) {
    return { pipeline, activity, chains: [], error: `Activity '${activity}' not found in pipeline '${pipeline}'` };
  }

  return { pipeline, activity, chains };
}

function collectChains(
  graph: Graph,
  pipelineId: string,
  pipelineName: string,
  activityFilter: string | undefined,
  chains: ConnectionChain[],
  visitedPipelines: Set<string>,
): void {
  const visited = new Set<string>();
  walkActivities(graph, pipelineId, pipelineName, activityFilter, chains, visited);

  // Follow ExecutePipeline edges (Executes edges are from pipeline, not activity)
  for (const edge of graph.getOutgoing(pipelineId)) {
    if (edge.type !== EdgeType.Executes) continue;
    if (visitedPipelines.has(edge.to)) continue;
    visitedPipelines.add(edge.to);

    const childNode = graph.getNode(edge.to);
    if (!childNode) continue;
    collectChains(graph, edge.to, childNode.name, undefined, chains, visitedPipelines);
  }
}

function walkActivities(
  graph: Graph,
  nodeId: string,
  pipelineName: string,
  activityFilter: string | undefined,
  chains: ConnectionChain[],
  visited: Set<string>,
): void {
  for (const edge of graph.getOutgoing(nodeId)) {
    if (edge.type !== EdgeType.Contains) continue;
    if (visited.has(edge.to)) continue;
    visited.add(edge.to);

    const actNode = graph.getNode(edge.to);
    if (!actNode) continue;

    // Recurse into container activities (Until, ForEach, IfCondition, Switch)
    walkActivities(graph, actNode.id, pipelineName, activityFilter, chains, visited);

    const { activity: actName } = parseActivityId(actNode.id);
    if (activityFilter && actName !== activityFilter) continue;

    const actType = (actNode.metadata.activityType as string) ?? "unknown";
    const steps: ConnectionChainStep[] = [];

    // Dataset → LinkedService → Secret chains
    for (const dsEdge of graph.getOutgoing(actNode.id)) {
      if (dsEdge.type !== EdgeType.UsesDataset) continue;
      const dsNode = graph.getNode(dsEdge.to);
      if (!dsNode) continue;

      steps.push({
        nodeType: dsNode.type,
        name: dsNode.name,
        edgeType: dsEdge.type,
        metadata: dsNode.metadata,
      });

      for (const lsEdge of graph.getOutgoing(dsNode.id)) {
        if (lsEdge.type !== EdgeType.UsesLinkedService) continue;
        appendLinkedServiceChain(graph, lsEdge.to, lsEdge.type, steps);
      }
    }

    // Direct activity → LinkedService edges (e.g., SqlServerStoredProcedure)
    for (const lsEdge of graph.getOutgoing(actNode.id)) {
      if (lsEdge.type !== EdgeType.UsesLinkedService) continue;
      appendLinkedServiceChain(graph, lsEdge.to, lsEdge.type, steps);
    }

    if (steps.length > 0) {
      chains.push({ pipeline: pipelineName, activity: actName, activityType: actType, steps });
    }
  }
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

  for (const secEdge of graph.getOutgoing(lsNodeId)) {
    if (secEdge.type !== EdgeType.ReferencesSecret) continue;
    const secNode = graph.getNode(secEdge.to);
    if (!secNode) continue;
    steps.push({
      nodeType: secNode.type,
      name: secNode.name,
      edgeType: secEdge.type,
      metadata: secNode.metadata,
    });
  }

  for (const vaultEdge of graph.getOutgoing(lsNodeId)) {
    if (vaultEdge.type !== EdgeType.UsesLinkedService) continue;
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
