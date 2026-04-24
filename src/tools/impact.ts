import { Graph, GraphEdge } from "../graph/model.js";

export type ImpactDirection = "upstream" | "downstream" | "both";

export interface AffectedEntry {
  nodeId: string;
  nodeType: string;
  name: string;
  depth: number;
  /** The edge path showing why this node is affected. */
  path: GraphEdge[];
}

export interface ImpactAnalysisResult {
  target: string;
  targetType: string;
  nodeId: string;
  direction: ImpactDirection;
  affected: AffectedEntry[];
  error?: string;
}

/**
 * Perform impact analysis for a given target node.
 * Traverses upstream, downstream, or both, and returns all affected nodes
 * along with the edge path explaining why each is affected.
 */
export function handleImpactAnalysis(
  graph: Graph,
  target: string,
  targetType: string,
  direction: ImpactDirection = "downstream",
): ImpactAnalysisResult {
  const nodeId = `${targetType}:${target}`;
  const node = graph.getNode(nodeId);

  if (!node) {
    return {
      target,
      targetType,
      nodeId,
      direction,
      affected: [],
      error: `Node '${nodeId}' not found in graph`,
    };
  }

  const seen = new Map<string, AffectedEntry>();

  function collect(dir: "upstream" | "downstream"): void {
    const results =
      dir === "downstream"
        ? graph.traverseDownstream(nodeId)
        : graph.traverseUpstream(nodeId);

    for (const r of results) {
      if (!seen.has(r.node.id)) {
        seen.set(r.node.id, {
          nodeId: r.node.id,
          nodeType: r.node.type,
          name: r.node.name,
          depth: r.depth,
          path: r.path,
        });
      }
    }
  }

  if (direction === "upstream" || direction === "both") {
    collect("upstream");
  }
  if (direction === "downstream" || direction === "both") {
    collect("downstream");
  }

  return {
    target,
    targetType,
    nodeId,
    direction,
    affected: Array.from(seen.values()),
  };
}
