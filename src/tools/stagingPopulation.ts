import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { getActivityMetadata } from "../graph/nodeMetadata.js";
import { lookupPipelineNode, resolveDestQueryDefaults, resolveActivityParams, getTableEdges } from "./toolUtils.js";
import { detectCdcPattern, classifyStagingRole, isCdcPipeline, type CdcPipelineInfo, type StagingRole } from "../utils/cdcPatterns.js";
import { extractAllTablesFromSql } from "../parsers/parseResult.js";
import { extractWhereClause } from "../parsers/sqlWhereParser.js";
import { makeTableId } from "../utils/nodeId.js";

export type StagingPopulationRole = StagingRole | "manual_inclusion" | "dv_mirror";

export interface StagingTableRole {
  table: string;
  role: StagingPopulationRole;
  roleEvidence: string;
  referencedInDestQuery: boolean;
  destQueryContext: string | null;
  populatedBy: Array<{ pipeline: string; activity: string; mechanism: string }>;
  consumedBy: Array<{ pipeline: string; activity: string; context: string }>;
}

export interface StagingPopulationResult {
  pipeline: string;
  dataverseEntity: string | null;
  destQuery: string | null;
  stagingTables: StagingTableRole[];
  unmappedTables: string[];
  summary: {
    totalTables: number;
    cdcTables: number;
    unknownRoleTables: number;
  };
  warnings: string[];
  error?: string;
}

function findTableUsage(graph: Graph, tableName: string): {
  populatedBy: Array<{ pipeline: string; activity: string; mechanism: string }>;
  consumedBy: Array<{ pipeline: string; activity: string; context: string }>;
} {
  const edges = getTableEdges(graph, tableName);
  const populatedBy: Array<{ pipeline: string; activity: string; mechanism: string }> = [];
  const consumedBy: Array<{ pipeline: string; activity: string; context: string }> = [];

  for (const e of edges) {
    const isSp = e.fromNodeType === NodeType.StoredProcedure || e.activityType === "SqlServerStoredProcedure";
    if (e.edgeType === EdgeType.WritesTo) {
      const mechanism = e.hasTruncate ? "truncate_insert" : isSp ? "stored_procedure" : "copy";
      populatedBy.push({ pipeline: e.pipeline, activity: e.activity, mechanism });
    } else if (e.edgeType === EdgeType.ReadsFrom) {
      consumedBy.push({ pipeline: e.pipeline, activity: e.activity, context: isSp ? "sp_read" : "source_query" });
    }
  }

  return { populatedBy, consumedBy };
}

export function handleStagingPopulation(
  graph: Graph,
  pipeline: string,
): StagingPopulationResult {
  const warnings: string[] = [];
  const lookup = lookupPipelineNode(graph, pipeline);
  if (lookup.error !== undefined) {
    return {
      pipeline,
      dataverseEntity: null,
      destQuery: null,
      stagingTables: [],
      unmappedTables: [],
      summary: { totalTables: 0, cdcTables: 0, unknownRoleTables: 0 },
      warnings: [],
      error: `Pipeline '${pipeline}' not found in graph`,
    };
  }

  // Try to get dest_query from pipeline defaults first
  let destQuery: string | null = null;
  let dataverseEntity: string | null = null;
  let cdcInfo: CdcPipelineInfo | null = null;

  const defaults = resolveDestQueryDefaults(lookup.node);
  if (defaults) {
    destQuery = defaults.destQuery;
    dataverseEntity = defaults.entityName;
  }

  // Also scan ExecutePipeline activities for CDC params and dest_query
  const outgoing = graph.getOutgoing(lookup.id);
  for (const edge of outgoing) {
    if (edge.type !== EdgeType.Contains) continue;
    const actNode = graph.getNode(edge.to);
    if (!actNode || actNode.type !== NodeType.Activity) continue;

    const meta = getActivityMetadata(actNode);
    if (meta.activityType !== "ExecutePipeline" || !meta.pipelineParameters) continue;

    const params = resolveActivityParams(graph, actNode);
    if (Object.keys(params).length === 0) continue;

    if (isCdcPipeline(params as Record<string, unknown>)) {
      cdcInfo = detectCdcPattern(params as Record<string, unknown>);
      if (!destQuery && cdcInfo.destQuery) destQuery = cdcInfo.destQuery;
      if (!dataverseEntity && cdcInfo.dataverseEntity) dataverseEntity = cdcInfo.dataverseEntity;
      break;
    }
  }

  if (!destQuery) {
    return {
      pipeline,
      dataverseEntity,
      destQuery: null,
      stagingTables: [],
      unmappedTables: [],
      summary: { totalTables: 0, cdcTables: 0, unknownRoleTables: 0 },
      warnings: ["No dest_query found for this pipeline"],
    };
  }

  // Extract all tables from dest_query at all depths
  const allTables = extractAllTablesFromSql(destQuery);
  const stagingTables: StagingTableRole[] = [];
  const unmappedTables: string[] = [];
  const seen = new Set<string>();

  // Also find tables in WHERE clause subqueries (unqualified references)
  const where = extractWhereClause(destQuery);
  const subqueryTables = where
    ? where.conditions.filter((c) => c.isSubquery && c.subqueryTable).map((c) => c.subqueryTable!)
    : [];

  // Combine schema-qualified tables and unqualified subquery tables
  const allTableNames = [
    ...allTables.map((t) => t.table),
    ...subqueryTables,
  ];

  for (const tableName of allTableNames) {
    const lower = tableName.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);

    // Strip schema for simpler name
    const simpleName = tableName.includes(".") ? tableName.split(".").pop()! : tableName;

    // Classify role
    let role: StagingPopulationRole;
    let roleEvidence: string;

    if (cdcInfo) {
      const classified = classifyStagingRole(simpleName, cdcInfo);
      role = classified;
      roleEvidence = classified !== "unknown"
        ? `Matched CDC parameter value`
        : "No CDC parameter match";
    } else {
      role = "unknown";
      roleEvidence = "No CDC context available";
    }

    // Check if it's a subquery reference in an OR condition (escape hatch)
    if (role === "unknown" && where) {
      const isEscapeHatch = where.conditions.some(
        (c) => c.connector === "OR" && c.isSubquery &&
          c.subqueryTable?.toLowerCase() === lower,
      );
      if (isEscapeHatch) {
        role = "manual_inclusion";
        roleEvidence = "Referenced in OR subquery (escape hatch pattern)";
      }
    }

    // Check naming conventions as last resort
    if (role === "unknown") {
      if (/^dataverse_/i.test(simpleName) && /_staging$/i.test(simpleName)) {
        role = "dv_mirror";
        roleEvidence = "Naming convention: DataVerse_*_Staging";
      }
    }

    // Find destQuery context (the SQL fragment referencing this table)
    let destQueryContext: string | null = null;
    const tableRef = allTables.find((t) => t.table.toLowerCase() === lower);
    const isInDestQuery = !!tableRef || subqueryTables.some((t) => t.toLowerCase() === lower);

    if (where) {
      const cond = where.conditions.find(
        (c) => c.isSubquery && c.subqueryTable?.toLowerCase() === lower,
      );
      if (cond) {
        destQueryContext = `${cond.column} ${cond.operator} ${cond.value.substring(0, 120)}`;
      }
    }

    // Look up graph usage
    const usage = findTableUsage(graph, simpleName);

    // Check if table exists in graph
    const tableId = makeTableId("dbo", simpleName);
    const altId = `table:${tableName}`;
    if (!graph.getNode(tableId) && !graph.getNode(altId)) {
      unmappedTables.push(tableName);
    }

    stagingTables.push({
      table: tableName,
      role,
      roleEvidence,
      referencedInDestQuery: isInDestQuery,
      destQueryContext,
      ...usage,
    });
  }

  const cdcRoles = ["cdc_current", "cdc_historical", "cdc_pending"];
  return {
    pipeline,
    dataverseEntity,
    destQuery,
    stagingTables,
    unmappedTables,
    summary: {
      totalTables: stagingTables.length,
      cdcTables: stagingTables.filter((t) => cdcRoles.includes(t.role)).length,
      unknownRoleTables: stagingTables.filter((t) => t.role === "unknown").length,
    },
    warnings,
  };
}
