import { Graph, GraphNode, GraphEdge, GraphStats } from "../graph/model.js";

export interface ExportResult {
  environment: string;
  exportedAt: string;
  stats: GraphStats;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function handleExport(graph: Graph, environment: string): ExportResult {
  return {
    environment,
    exportedAt: new Date().toISOString(),
    stats: graph.stats(),
    nodes: graph.allNodes(),
    edges: graph.allEdges(),
  };
}
