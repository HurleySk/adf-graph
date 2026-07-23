import { GraphNode, GraphEdge } from "../graph/model.js";

export interface ParseResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
}

const SQL_KEYWORDS = new Set([
  "select", "values", "openrowset", "openjson",
  "opendatasource", "openquery", "openxml",
]);

function resolveTableRef(match: RegExpExecArray): string | null {
  if (match[2]) {
    return `${match[1]}.${match[2]}`;
  }
  if (SQL_KEYWORDS.has(match[1].toLowerCase())) {
    return null;
  }
  return `dbo.${match[1]}`;
}

/**
 * Extract schema.table pairs from SQL using FROM/JOIN patterns.
 * Only extracts tables at the top query level -- tables inside
 * parenthesized subqueries (e.g. WHERE EXISTS (...)) are excluded
 * because they are filters, not data sources.
 */
export function extractTablesFromSql(sql: string): string[] {
  const regex = /(?:FROM|JOIN)\s+\[?(\w+)\]?(?:\.\[?(\w+)\]?)?/gi;
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
      const ref = resolveTableRef(match);
      if (ref) results.push(ref);
    }
  }
  return results;
}

export interface TableRef {
  table: string;
  depth: number;
}

/**
 * Like extractTablesFromSql but captures tables at ALL parenthesis depths.
 * Callers can distinguish main tables (depth 0) from subquery tables (depth > 0).
 */
export function extractAllTablesFromSql(sql: string): TableRef[] {
  const regex = /(?:FROM|JOIN)\s+\[?(\w+)\]?(?:\.\[?(\w+)\]?)?/gi;
  const results: TableRef[] = [];

  const depthArr = new Int8Array(sql.length);
  let d = 0;
  for (let i = 0; i < sql.length; i++) {
    if (sql[i] === "(") d++;
    depthArr[i] = d;
    if (sql[i] === ")") d--;
  }

  let match: RegExpExecArray | null;
  while ((match = regex.exec(sql)) !== null) {
    const ref = resolveTableRef(match);
    if (ref) results.push({ table: ref, depth: depthArr[match.index] });
  }
  return results;
}
