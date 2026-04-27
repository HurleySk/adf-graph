import { Graph, EdgeType, NodeType } from "../graph/model.js";
import { lookupPipelineNode } from "./toolUtils.js";
import { parseNodeId } from "../utils/nodeId.js";

export interface AncestryChain {
  root: string;
  chain: string[];
  depth: number;
}

export interface OrchestratorAncestryResult {
  pipeline: string;
  isRoot: boolean;
  ancestors: AncestryChain[];
  error?: string;
}

/**
 * Find root orchestrator pipelines that own a given pipeline.
 * Walks upstream via Executes edges to find all root orchestrators
 * and returns full ancestry chains with depth.
 */
export function handleFindOrchestrators(
  graph: Graph,
  pipeline: string,
): OrchestratorAncestryResult {
  const lookup = lookupPipelineNode(graph, pipeline);
  if (lookup.error) {
    return {
      pipeline,
      isRoot: false,
      ancestors: [],
      error: lookup.error,
    };
  }

  const targetId = lookup.id;

  // Check if the pipeline itself is a root (no incoming Executes edges)
  const incomingExecutes = graph
    .getIncoming(targetId)
    .filter((e) => e.type === EdgeType.Executes);

  if (incomingExecutes.length === 0) {
    return {
      pipeline,
      isRoot: true,
      ancestors: [{ root: pipeline, chain: [pipeline], depth: 0 }],
    };
  }

  // DFS upstream to find all paths from roots to the target pipeline.
  // We build paths from the target upward, then reverse them.
  const chains: AncestryChain[] = [];

  function dfs(currentId: string, path: string[], visited: Set<string>): void {
    const incoming = graph
      .getIncoming(currentId)
      .filter((e) => e.type === EdgeType.Executes);

    if (incoming.length === 0) {
      // currentId is a root — path is [target, ..., root], reverse to get root → target
      const chain = [...path].reverse();
      chains.push({
        root: chain[0],
        chain,
        depth: chain.length - 1,
      });
      return;
    }

    for (const edge of incoming) {
      const parentId = edge.from;
      if (visited.has(parentId)) continue;

      const parentNode = graph.getNode(parentId);
      if (!parentNode || parentNode.type !== NodeType.Pipeline) continue;

      visited.add(parentId);
      path.push(parentNode.name);
      dfs(parentId, path, visited);
      path.pop();
      visited.delete(parentId);
    }
  }

  const visited = new Set<string>([targetId]);
  dfs(targetId, [pipeline], visited);

  return {
    pipeline,
    isRoot: false,
    ancestors: chains,
  };
}
