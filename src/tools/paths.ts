import { Graph } from "../graph/model.js";

export interface PathEdge {
  from: string;
  to: string;
  edgeType: string;
}

export interface PathResult {
  edges: PathEdge[];
  length: number;
}

export interface FindPathsResult {
  from: string;
  to: string;
  paths: PathResult[];
}

/**
 * Find all paths between two nodes in the graph.
 * - If `fromType` is provided, fromId = `${fromType}:${from}`, otherwise use `from` as-is
 * - If `toType` is provided, toId = `${toType}:${to}`, otherwise use `to` as-is
 * - Returns all paths as arrays of PathEdge with from, to, and edgeType
 */
export function handleFindPaths(
  graph: Graph,
  from: string,
  to: string,
  fromType?: string,
  toType?: string,
): FindPathsResult {
  const fromId = fromType ? `${fromType}:${from}` : from;
  const toId = toType ? `${toType}:${to}` : to;

  const rawPaths = graph.findPaths(fromId, toId);

  const paths: PathResult[] = rawPaths.map((edgeArray) => ({
    edges: edgeArray.map((edge) => ({
      from: edge.from,
      to: edge.to,
      edgeType: edge.type,
    })),
    length: edgeArray.length,
  }));

  return { from, to, paths };
}
