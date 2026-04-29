import { GraphNode, GraphEdge, NodeType, EdgeType } from "../../graph/model.js";
import { extractTablesFromSql } from "../parseResult.js";
import { asString } from "../../utils/expressionValue.js";

export function processDatasetParams(
  activityId: string,
  params: Record<string, unknown>,
  direction: "reads_from" | "writes_to",
  edges: GraphEdge[],
): void {
  const edgeType = direction === "reads_from" ? EdgeType.ReadsFrom : EdgeType.WritesTo;

  const entityName = asString(params.entity_name);
  if (entityName && !entityName.startsWith("@")) {
    edges.push({
      from: activityId,
      to: `${NodeType.DataverseEntity}:${entityName}`,
      type: edgeType,
      metadata: {},
    });
  }

  const tableName = asString(params.table_name);
  const schemaName = asString(params.schema_name);
  if (tableName && !tableName.startsWith("@")) {
    const schema = schemaName && !schemaName.startsWith("@") ? schemaName : "dbo";
    edges.push({
      from: activityId,
      to: `${NodeType.Table}:${schema}.${tableName}`,
      type: edgeType,
      metadata: {},
    });
  }
}

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

  const source = typeProperties?.source as Record<string, unknown> | undefined;
  const sqlText = asString(source?.sqlReaderQuery) ?? null;
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

  if (source) {
    activityNode.metadata.sourceType = source.type as string | undefined;
  }

  const sink = typeProperties?.sink as Record<string, unknown> | undefined;
  if (sink) {
    activityNode.metadata.sinkType = sink.type as string | undefined;
    activityNode.metadata.sinkWriteBehavior = sink.writeBehavior as string | undefined;
    activityNode.metadata.sinkIgnoreNullValues = sink.ignoreNullValues as boolean | undefined;
    activityNode.metadata.sinkAlternateKeyName = sink.alternateKeyName as string | undefined;
  }

  return { edges, warnings };
}
