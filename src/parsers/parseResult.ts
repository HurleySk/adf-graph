import { GraphNode, GraphEdge } from "../graph/model.js";

export interface ParseResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
}

/**
 * Extract schema.table pairs from SQL using FROM/JOIN patterns.
 */
export function extractTablesFromSql(sql: string): string[] {
  const regex = /(?:FROM|JOIN)\s+\[?(\w+)\]?\.\[?(\w+)\]?/gi;
  const results: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(sql)) !== null) {
    results.push(`${match[1]}.${match[2]}`);
  }
  return results;
}
