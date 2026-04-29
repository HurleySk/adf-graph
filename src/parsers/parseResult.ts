import { GraphNode, GraphEdge } from "../graph/model.js";

export interface ParseResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
}

/**
 * Extract schema.table pairs from SQL using FROM/JOIN patterns.
 * Only extracts tables at the top query level — tables inside
 * parenthesized subqueries (e.g. WHERE EXISTS (...)) are excluded
 * because they are filters, not data sources.
 */
export function extractTablesFromSql(sql: string): string[] {
  const regex = /(?:FROM|JOIN)\s+\[?(\w+)\]?\.\[?(\w+)\]?/gi;
  const results: string[] = [];

  // Pre-compute parenthesis depth at each character position
  const depth = new Int8Array(sql.length);
  let d = 0;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "(") d++;
    depth[i] = d;
    if (sql[i] === ")") d--;
  }

  let match: RegExpExecArray | null;
  while ((match = regex.exec(sql)) !== null) {
    if (depth[match.index] === 0) {
      results.push(`${match[1]}.${match[2]}`);
    }
  }
  return results;
}
