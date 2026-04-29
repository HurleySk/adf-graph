import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { getActivityMetadata } from "../graph/nodeMetadata.js";
import { makeEntityId, makeNodeId } from "../utils/nodeId.js";
import { extractWhereClause, type WhereClause } from "../parsers/sqlWhereParser.js";
import { resolveChildParameters } from "../utils/parameterResolver.js";
import { asNonDynamic } from "../utils/expressionValue.js";
import { parseActivityId } from "../utils/nodeId.js";

export interface FilterStep {
  pipeline: string;
  activity: string;
  activityType: string;
  sqlContext: string;
  whereClause: WhereClause | null;
  fullSql: string;
}

export interface FilterChainResult {
  entity: string;
  chain: FilterStep[];
  summary: {
    totalFilters: number;
    tablesReferenced: string[];
    hasEscapeHatches: boolean;
  };
  warnings: string[];
  error?: string;
}

function resolveEntityNodeId(graph: Graph, entity: string): string | null {
  let nodeId = makeEntityId(entity);
  if (graph.getNode(nodeId)) return nodeId;

  nodeId = makeNodeId(NodeType.Table, entity);
  if (graph.getNode(nodeId)) return nodeId;

  nodeId = makeNodeId(NodeType.Table, `dbo.${entity}`);
  if (graph.getNode(nodeId)) return nodeId;

  const entityLower = entity.toLowerCase();
  const tableNodes = graph.getNodesByType(NodeType.Table);
  const match = tableNodes.find((n) => {
    const idSuffix = n.id.slice("table:".length);
    if (idSuffix.toLowerCase() === entityLower) return true;
    const dotIdx = idSuffix.indexOf(".");
    if (dotIdx >= 0 && idSuffix.slice(dotIdx + 1).toLowerCase() === entityLower) return true;
    return false;
  });
  return match?.id ?? null;
}

export function handleFilterChain(
  graph: Graph,
  entity: string,
): FilterChainResult {
  const warnings: string[] = [];
  const chain: FilterStep[] = [];

  const nodeId = resolveEntityNodeId(graph, entity);
  if (!nodeId) {
    return {
      entity,
      chain: [],
      summary: { totalFilters: 0, tablesReferenced: [], hasEscapeHatches: false },
      warnings: [],
      error: `Entity or table '${entity}' not found in graph`,
    };
  }

  // Traverse upstream to find all activities that feed this entity/table
  const upstream = graph.traverseUpstream(nodeId);
  const visited = new Set<string>();

  for (const result of upstream) {
    if (result.node.type !== NodeType.Activity) continue;
    if (visited.has(result.node.id)) continue;
    visited.add(result.node.id);

    const meta = getActivityMetadata(result.node);
    const { pipeline } = parseActivityId(result.node.id);

    // 1. Copy activity with sqlReaderQuery
    if (meta.sqlQuery) {
      const where = meta.sqlWhereClause
        ? { raw: meta.sqlWhereClause, conditions: meta.sqlFilterConditions ?? [] }
        : extractWhereClause(meta.sqlQuery);

      chain.push({
        pipeline,
        activity: result.node.name,
        activityType: meta.activityType,
        sqlContext: "sqlReaderQuery",
        whereClause: where,
        fullSql: meta.sqlQuery,
      });
    }

    // 2. ExecutePipeline with embedded SQL in parameters
    if (meta.activityType === "ExecutePipeline" && meta.pipelineParameters) {
      const resolved = resolveChildParameters(graph, result.node);
      const params = resolved
        ? Object.fromEntries(resolved.resolvedParameters.map((p) => [p.name, p.resolvedValue]))
        : meta.pipelineParameters;

      for (const [key, val] of Object.entries(params)) {
        if (key !== "source_query" && key !== "dest_query") continue;
        const sqlStr = asNonDynamic(val) ?? (typeof val === "string" ? val : null);
        if (!sqlStr || sqlStr.startsWith("@")) continue;

        const where = extractWhereClause(sqlStr);
        chain.push({
          pipeline,
          activity: result.node.name,
          activityType: meta.activityType,
          sqlContext: key,
          whereClause: where,
          fullSql: sqlStr,
        });
      }
    }
  }

  // Order: source_query first, then sqlReaderQuery, then dest_query
  const contextOrder: Record<string, number> = {
    source_query: 0,
    sqlReaderQuery: 1,
    dest_query: 2,
  };
  chain.sort((a, b) => (contextOrder[a.sqlContext] ?? 99) - (contextOrder[b.sqlContext] ?? 99));

  // Build summary
  const allTables = new Set<string>();
  let hasEscapeHatches = false;
  let totalFilters = 0;

  for (const step of chain) {
    if (!step.whereClause) continue;
    totalFilters += step.whereClause.conditions.length;
    for (const cond of step.whereClause.conditions) {
      if (cond.subqueryTable) allTables.add(cond.subqueryTable);
      if (cond.connector === "OR" && cond.isSubquery) hasEscapeHatches = true;
    }
  }

  return {
    entity,
    chain,
    summary: {
      totalFilters,
      tablesReferenced: Array.from(allTables),
      hasEscapeHatches,
    },
    warnings,
  };
}
