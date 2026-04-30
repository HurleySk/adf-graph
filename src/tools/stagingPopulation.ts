import { Graph, NodeType, EdgeType } from "../graph/model.js";
import { getActivityMetadata } from "../graph/nodeMetadata.js";
import { lookupPipelineNode, resolveDestQueryDefaults } from "./toolUtils.js";
import { resolveChildParameters } from "../utils/parameterResolver.js";
import { detectCdcPattern, classifyStagingRole, isCdcPipeline, type CdcPipelineInfo, type StagingRole } from "../utils/cdcPatterns.js";
import { extractAllTablesFromSql } from "../parsers/parseResult.js";
import { extractWhereClause } from "../parsers/sqlWhereParser.js";
import { parseActivityId, makeTableId } from "../utils/nodeId.js";
import { asNonDynamic } from "../utils/expressionValue.js";

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
  const populatedBy: Array<{ pipeline: string; activity: string; mechanism: string }> = [];
  const consumedBy: Array<{ pipeline: string; activity: string; context: string }> = [];

  // Try both with and without schema prefix
  const candidates = [
    makeTableId("dbo", tableName),
    `table:${tableName}`,
  ];

  for (const tableId of candidates) {
    const node = graph.getNode(tableId);
    if (!node) continue;

    const incoming = graph.getIncoming(tableId);
    for (const edge of incoming) {
      const fromNode = graph.getNode(edge.from);
      if (!fromNode) continue;

      if (fromNode.type === NodeType.Activity) {
        const { pipeline, activity } = parseActivityId(edge.from);
        const meta = getActivityMetadata(fromNode);
        if (edge.type === EdgeType.WritesTo) {
          const mechanism = meta.sqlQuery && /TRUNCATE\s+TABLE/i.test(meta.sqlQuery)
            ? "truncate_insert"
            : meta.activityType === "SqlServerStoredProcedure" ? "stored_procedure" : "copy";
          populatedBy.push({ pipeline, activity, mechanism });
        } else if (edge.type === EdgeType.ReadsFrom) {
          consumedBy.push({ pipeline, activity, context: "source_query" });
        }
      } else if (fromNode.type === NodeType.StoredProcedure) {
        if (edge.type === EdgeType.WritesTo) {
          populatedBy.push({ pipeline: "(stored procedure)", activity: fromNode.name, mechanism: "stored_procedure" });
        } else if (edge.type === EdgeType.ReadsFrom) {
          consumedBy.push({ pipeline: "(stored procedure)", activity: fromNode.name, context: "sp_read" });
        }
      }
    }
    if (populatedBy.length > 0 || consumedBy.length > 0) break;
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

    const resolved = resolveChildParameters(graph, actNode);
    if (!resolved) continue;

    const params = Object.fromEntries(
      resolved.resolvedParameters.map((p) => [p.name, p.resolvedValue]),
    );

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
