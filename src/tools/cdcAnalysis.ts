import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { getActivityMetadata, getActivityType } from "../graph/nodeMetadata.js";
import { lookupPipelineNode } from "./toolUtils.js";
import { resolveChildParameters, type ResolvedChildPipeline } from "../utils/parameterResolver.js";
import { detectCdcPattern, isCdcPipeline, classifyStagingRole, type CdcPipelineInfo, type StagingRole } from "../utils/cdcPatterns.js";
import { extractWhereClause, type FilterCondition, type WhereClause } from "../parsers/sqlWhereParser.js";
import { parseActivityId, makeTableId } from "../utils/nodeId.js";
import { asNonDynamic } from "../utils/expressionValue.js";

export interface CdcStagingTable {
  name: string;
  role: StagingRole;
  writers: string[];
  readers: string[];
  hasTruncate: boolean;
}

export interface CdcFilterInfo {
  stage: string;
  sql: string;
  whereClause: WhereClause | null;
  escapeHatches: FilterCondition[];
}

export interface CdcGap {
  severity: "error" | "warning";
  category: "missing_table" | "no_cleanup" | "missing_filter" | "orphan_staging";
  message: string;
}

export interface CdcCallSite {
  callerActivity: string;
  childPipeline: string;
  cdcInfo: CdcPipelineInfo;
  stagingTables: CdcStagingTable[];
  filterChain: CdcFilterInfo[];
  gaps: CdcGap[];
}

export interface CdcAnalysisResult {
  pipeline: string;
  cdcCalls: CdcCallSite[];
  summary: {
    totalCdcCalls: number;
    totalGaps: number;
    gapsByCategory: Record<string, number>;
  };
  warnings: string[];
  error?: string;
}

const TRUNCATE_PATTERN = /TRUNCATE\s+TABLE/i;

function getTableUsage(graph: Graph, tableName: string): { writers: string[]; readers: string[]; hasTruncate: boolean } {
  let tableId = makeTableId("dbo", tableName);
  let node = graph.getNode(tableId);
  if (!node) {
    tableId = `table:${tableName}`;
    node = graph.getNode(tableId);
  }
  if (!node) return { writers: [], readers: [], hasTruncate: false };

  const incoming = graph.getIncoming(tableId);
  const writers: string[] = [];
  const readers: string[] = [];
  let hasTruncate = false;

  for (const edge of incoming) {
    const fromNode = graph.getNode(edge.from);
    if (!fromNode) continue;

    if (fromNode.type === NodeType.Activity) {
      const { pipeline, activity } = parseActivityId(edge.from);
      const label = `${pipeline}/${activity}`;

      if (edge.type === EdgeType.WritesTo) {
        writers.push(label);
        const meta = getActivityMetadata(fromNode);
        if (meta.sqlQuery && TRUNCATE_PATTERN.test(meta.sqlQuery)) hasTruncate = true;
      } else if (edge.type === EdgeType.ReadsFrom) {
        readers.push(label);
      }
    }
  }

  return { writers, readers, hasTruncate };
}

function buildStagingTables(graph: Graph, cdc: CdcPipelineInfo): CdcStagingTable[] {
  const tables: CdcStagingTable[] = [];
  const seen = new Set<string>();

  const candidates = [
    cdc.cdcCurrentTable,
    cdc.cdcHistoricalTable,
    cdc.cdcPendingTable,
    cdc.destObjectName,
  ].filter((t): t is string => t !== null && t !== "");

  for (const name of candidates) {
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());

    const usage = getTableUsage(graph, name);
    tables.push({
      name,
      role: classifyStagingRole(name, cdc),
      ...usage,
    });
  }

  return tables;
}

function buildFilterChain(cdc: CdcPipelineInfo): CdcFilterInfo[] {
  const chain: CdcFilterInfo[] = [];

  if (cdc.sourceQuery) {
    const where = extractWhereClause(cdc.sourceQuery);
    chain.push({
      stage: "source_to_staging",
      sql: cdc.sourceQuery,
      whereClause: where,
      escapeHatches: [],
    });
  }

  if (cdc.cdcSourceTableQuery) {
    const where = extractWhereClause(cdc.cdcSourceTableQuery);
    chain.push({
      stage: "cdc_tracking",
      sql: cdc.cdcSourceTableQuery,
      whereClause: where,
      escapeHatches: [],
    });
  }

  if (cdc.destQuery) {
    const where = extractWhereClause(cdc.destQuery);
    const escapeHatches = where
      ? where.conditions.filter((c) => c.connector === "OR" && c.isSubquery)
      : [];
    chain.push({
      stage: "staging_to_dv",
      sql: cdc.destQuery,
      whereClause: where,
      escapeHatches,
    });
  }

  return chain;
}

function detectGaps(cdc: CdcPipelineInfo, stagingTables: CdcStagingTable[], graph: Graph): CdcGap[] {
  const gaps: CdcGap[] = [];

  // Check if CDC tables exist in graph
  const checkTable = (name: string | null, role: string) => {
    if (!name) return;
    const tableId = makeTableId("dbo", name);
    if (!graph.getNode(tableId)) {
      gaps.push({
        severity: "warning",
        category: "missing_table",
        message: `${role} table '${name}' not found in graph`,
      });
    }
  };
  checkTable(cdc.cdcCurrentTable, "CDC current");
  checkTable(cdc.cdcHistoricalTable, "CDC historical");
  checkTable(cdc.cdcPendingTable, "CDC pending");

  // Check for cleanup SP
  if (!cdc.storedProcedure) {
    gaps.push({
      severity: "warning",
      category: "no_cleanup",
      message: "No cleanup stored procedure configured — CDC current table may grow unbounded",
    });
  }

  // Check for dest_query filters
  if (cdc.destQuery) {
    const where = extractWhereClause(cdc.destQuery);
    if (!where || where.conditions.length === 0) {
      gaps.push({
        severity: "warning",
        category: "missing_filter",
        message: "dest_query has no WHERE clause — all staging rows will be pushed to Dataverse",
      });
    }
  }

  // Check for orphan staging
  for (const table of stagingTables) {
    if (table.role === "staging" && table.writers.length > 0 && table.readers.length === 0) {
      gaps.push({
        severity: "warning",
        category: "orphan_staging",
        message: `Staging table '${table.name}' is written to but never read from in the graph`,
      });
    }
  }

  return gaps;
}

export function handleCdcAnalysis(
  graph: Graph,
  pipeline: string,
): CdcAnalysisResult {
  const warnings: string[] = [];
  const lookup = lookupPipelineNode(graph, pipeline);
  if (lookup.error !== undefined) {
    return {
      pipeline,
      cdcCalls: [],
      summary: { totalCdcCalls: 0, totalGaps: 0, gapsByCategory: {} },
      warnings: [],
      error: `Pipeline '${pipeline}' not found in graph`,
    };
  }

  const cdcCalls: CdcCallSite[] = [];

  // Walk all activities in this pipeline (recursively through containers)
  const queue = [lookup.id];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const parentId = queue.shift()!;
    if (visited.has(parentId)) continue;
    visited.add(parentId);

    const outgoing = graph.getOutgoing(parentId);
    for (const edge of outgoing) {
      if (edge.type !== EdgeType.Contains) continue;
      const actNode = graph.getNode(edge.to);
      if (!actNode || actNode.type !== NodeType.Activity) continue;

      const meta = getActivityMetadata(actNode);

      // Check if this is an ExecutePipeline calling a CDC child
      if (meta.activityType === "ExecutePipeline" && meta.pipelineParameters) {
        const resolved = resolveChildParameters(graph, actNode);
        const params = resolved
          ? Object.fromEntries(resolved.resolvedParameters.map((p) => [p.name, p.resolvedValue]))
          : meta.pipelineParameters;

        if (isCdcPipeline(params as Record<string, unknown>)) {
          const cdcInfo = detectCdcPattern(params as Record<string, unknown>);
          const stagingTables = buildStagingTables(graph, cdcInfo);
          const filterChain = buildFilterChain(cdcInfo);
          const gaps = detectGaps(cdcInfo, stagingTables, graph);

          cdcCalls.push({
            callerActivity: actNode.name,
            childPipeline: meta.executedPipeline ?? "unknown",
            cdcInfo,
            stagingTables,
            filterChain,
            gaps,
          });
        }
      }

      // Recurse into container activities
      queue.push(actNode.id);
    }
  }

  // Build summary
  const gapsByCategory: Record<string, number> = {};
  let totalGaps = 0;
  for (const call of cdcCalls) {
    for (const gap of call.gaps) {
      gapsByCategory[gap.category] = (gapsByCategory[gap.category] ?? 0) + 1;
      totalGaps++;
    }
  }

  return {
    pipeline,
    cdcCalls,
    summary: {
      totalCdcCalls: cdcCalls.length,
      totalGaps,
      gapsByCategory,
    },
    warnings,
  };
}
