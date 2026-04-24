import { Graph, NodeType, EdgeType, GraphStats } from "../graph/model.js";

export interface StatsResult {
  nodeCount: number;
  edgeCount: number;
  nodesByType: Partial<Record<NodeType, number>>;
  edgesByType: Partial<Record<EdgeType, number>>;
  lastBuild: string | null;
  isStale: boolean;
  warnings: string[];
}

/**
 * Returns aggregate statistics about the current graph, including staleness
 * and any build warnings.
 */
export function handleStats(
  graph: Graph,
  lastBuildTime: Date | null,
  isStale: boolean,
  warnings: string[],
): StatsResult {
  const stats: GraphStats = graph.stats();
  return {
    nodeCount: stats.nodeCount,
    edgeCount: stats.edgeCount,
    nodesByType: stats.nodesByType,
    edgesByType: stats.edgesByType,
    lastBuild: lastBuildTime ? lastBuildTime.toISOString() : null,
    isStale,
    warnings,
  };
}
