import { GraphNode, GraphEdge, NodeType, EdgeType } from "../../graph/model.js";
import { extractTablesFromSql } from "../parseResult.js";
import { asString } from "../../utils/expressionValue.js";

/**
 * Process dataset parameters to create reads_from/writes_to edges for
 * entity_name (Dataverse) and table_name (SQL table) references.
 */
export function processDatasetParams(
  activityId: string,
  params: Record<string, unknown>,
  direction: "reads_from" | "writes_to",
  edges: GraphEdge[],
): void {
  const edgeType = direction === "reads_from" ? EdgeType.ReadsFrom : EdgeType.WritesTo;

  const entityName = params.entity_name;
  if (typeof entityName === "string" && !entityName.startsWith("@")) {
    edges.push({
      from: activityId,
      to: `${NodeType.DataverseEntity}:${entityName}`,
      type: edgeType,
      metadata: {},
    });
  }

  const tableName = params.table_name;
  const schemaName = params.schema_name;
  if (typeof tableName === "string" && !tableName.startsWith("@")) {
    const schema = typeof schemaName === "string" ? schemaName : "dbo";
    edges.push({
      from: activityId,
      to: `${NodeType.Table}:${schema}.${tableName}`,
      type: edgeType,
      metadata: {},
    });
  }
}

/**
 * Handle Copy activity-specific logic:
 *   - Input/output dataset references (uses_dataset edges)
 *   - Dataset parameter extraction (reads_from/writes_to for tables and DV entities)
 *   - SQL reader query extraction (reads_from table edges + sqlQuery metadata)
 *   - FetchXML query extraction (fetchXmlQuery metadata)
 */
export function parseCopyActivity(
  activity: Record<string, unknown>,
  activityNode: GraphNode,
): { edges: GraphEdge[]; warnings: string[] } {
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];
  const activityId = activityNode.id;
  const typeProperties = activity.typeProperties as Record<string, unknown> | undefined;

  const inputs = (activity.inputs as unknown[]) ?? [];
  const outputs = (activity.outputs as unknown[]) ?? [];

  // inputs -> uses_dataset (reads)
  for (const inp of inputs) {
    const i = inp as Record<string, unknown>;
    const refName = asString(i.referenceName);
    if (!refName) continue;
    edges.push({
      from: activityId,
      to: `${NodeType.Dataset}:${refName}`,
      type: EdgeType.UsesDataset,
      metadata: {},
    });

    const params = i.parameters as Record<string, unknown> | undefined;
    if (params) {
      processDatasetParams(activityId, params, "reads_from", edges);
    }
  }

  // outputs -> uses_dataset (writes)
  for (const out of outputs) {
    const o = out as Record<string, unknown>;
    const refName = asString(o.referenceName);
    if (!refName) continue;
    edges.push({
      from: activityId,
      to: `${NodeType.Dataset}:${refName}`,
      type: EdgeType.UsesDataset,
      metadata: {},
    });

    const params = o.parameters as Record<string, unknown> | undefined;
    if (params) {
      processDatasetParams(activityId, params, "writes_to", edges);
    }
  }

  // SQL reader query -> reads_from table
  const source = typeProperties?.source as Record<string, unknown> | undefined;
  const sqlQuery = source?.sqlReaderQuery;
  let sqlText: string | null = null;
  if (typeof sqlQuery === "string") {
    sqlText = sqlQuery;
  } else if (sqlQuery && typeof sqlQuery === "object") {
    const q = sqlQuery as Record<string, unknown>;
    if (q.type === "Expression" && typeof q.value === "string") {
      sqlText = q.value;
    }
  }
  if (sqlText) {
    const tables = extractTablesFromSql(sqlText);
    for (const tbl of tables) {
      edges.push({
        from: activityId,
        to: `${NodeType.Table}:${tbl}`,
        type: EdgeType.ReadsFrom,
        metadata: {},
      });
    }
    activityNode.metadata.sqlQuery = sqlText;
  }

  const fetchXml = source?.query;
  if (typeof fetchXml === "string" && fetchXml.trim().startsWith("<")) {
    activityNode.metadata.fetchXmlQuery = fetchXml;
  }

  return { edges, warnings };
}
