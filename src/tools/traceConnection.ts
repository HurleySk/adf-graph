import { collectContainedActivities } from "../graph/traversalUtils.js";
import { getActivityType } from "../graph/nodeMetadata.js";
import { Graph, GraphNode, EdgeType } from "../graph/model.js";
import { lookupPipelineNode } from "./toolUtils.js";
import { parseActivityId } from "../utils/nodeId.js";

export interface ConnectionChainStep {
  nodeType: string;
  name: string;
  edgeType: string;
  metadata: Record<string, unknown>;
  role?: "source" | "sink";
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

function makeStep(
  node: GraphNode,
  edgeType: string,
  role?: "source" | "sink",
): ConnectionChainStep {
  return {
    nodeType: node.type,
    name: node.name,
    edgeType,
    metadata: node.metadata,
    ...(role ? { role } : {}),
  };
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
  walkActivities(graph, pipelineId, pipelineName, activityFilter, chains);

  // Follow ExecutePipeline edges (Executes edges are from pipeline, not activity)
  for (const edge of graph.getOutgoing(pipelineId, EdgeType.Executes)) {
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
): void {
  for (const { node: actNode } of collectContainedActivities(graph, nodeId)) {
    const { activity: actName } = parseActivityId(actNode.id);
    if (activityFilter && actName !== activityFilter) continue;

    const actType = getActivityType(actNode);
    const steps: ConnectionChainStep[] = [];

    // Dataset → LinkedService → Secret chains
    for (const dsEdge of graph.getOutgoing(actNode.id, EdgeType.UsesDataset)) {
      const dsNode = graph.getNode(dsEdge.to);
      if (!dsNode) continue;

      const dir = dsEdge.metadata.direction as string | undefined;
      const role = dir === "input" ? "source" as const : dir === "output" ? "sink" as const : undefined;

      steps.push(makeStep(dsNode, dsEdge.type, role));

      for (const lsEdge of graph.getOutgoing(dsNode.id, EdgeType.UsesLinkedService)) {
        appendLinkedServiceChain(graph, lsEdge.to, lsEdge.type, steps, role);
      }
    }

    // Direct activity → LinkedService edges (e.g., SqlServerStoredProcedure)
    for (const lsEdge of graph.getOutgoing(actNode.id, EdgeType.UsesLinkedService)) {
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
  role?: "source" | "sink",
): void {
  const lsNode = graph.getNode(lsNodeId);
  if (!lsNode) return;

  steps.push(makeStep(lsNode, edgeType, role));

  for (const secEdge of graph.getOutgoing(lsNodeId, EdgeType.ReferencesSecret)) {
    const secNode = graph.getNode(secEdge.to);
    if (!secNode) continue;
    steps.push(makeStep(secNode, secEdge.type, role));
  }

  for (const vaultEdge of graph.getOutgoing(lsNodeId, EdgeType.UsesLinkedService)) {
    const vaultNode = graph.getNode(vaultEdge.to);
    if (!vaultNode) continue;
    steps.push(makeStep(vaultNode, vaultEdge.type, role));
  }
}
