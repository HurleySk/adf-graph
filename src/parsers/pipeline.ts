import { GraphNode, GraphEdge, NodeType, EdgeType } from "../graph/model.js";

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

function normalizeSpName(raw: string): string {
  // [dbo].[p_Transform_Org] → dbo.p_Transform_Org
  return raw.replace(/\[/g, "").replace(/\]/g, "");
}

export function parsePipelineFile(json: unknown): ParseResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  if (!json || typeof json !== "object") {
    warnings.push("Invalid pipeline JSON: not an object");
    return { nodes, edges, warnings };
  }

  const root = json as Record<string, unknown>;
  const pipelineName = root.name as string;
  const properties = root.properties as Record<string, unknown> | undefined;
  const activities = (properties?.activities as unknown[]) ?? [];

  // Pipeline node
  const pipelineId = `${NodeType.Pipeline}:${pipelineName}`;
  nodes.push({
    id: pipelineId,
    type: NodeType.Pipeline,
    name: pipelineName,
    metadata: {},
  });

  for (const act of activities) {
    const activity = act as Record<string, unknown>;
    const activityName = activity.name as string;
    const activityType = activity.type as string;
    const activityId = `${NodeType.Activity}:${pipelineName}/${activityName}`;
    const typeProperties = activity.typeProperties as Record<string, unknown> | undefined;

    // Activity node
    nodes.push({
      id: activityId,
      type: NodeType.Activity,
      name: activityName,
      metadata: { activityType },
    });

    // Pipeline → Activity (contains)
    edges.push({
      from: pipelineId,
      to: activityId,
      type: EdgeType.Contains,
      metadata: {},
    });

    // dependsOn edges (activity→activity)
    const dependsOn = (activity.dependsOn as unknown[]) ?? [];
    for (const dep of dependsOn) {
      const d = dep as Record<string, unknown>;
      const depName = d.activity as string;
      const depId = `${NodeType.Activity}:${pipelineName}/${depName}`;
      edges.push({
        from: activityId,
        to: depId,
        type: EdgeType.DependsOn,
        metadata: {},
      });
    }

    // ExecutePipeline → executes edge (from pipeline, not activity)
    if (activityType === "ExecutePipeline") {
      const refPipeline = typeProperties?.pipeline as Record<string, unknown> | undefined;
      const refName = refPipeline?.referenceName as string | undefined;
      if (refName) {
        if (refName.startsWith("@")) {
          warnings.push(`Dynamic pipeline reference in activity '${activityName}': ${refName}`);
        } else {
          edges.push({
            from: pipelineId,
            to: `${NodeType.Pipeline}:${refName}`,
            type: EdgeType.Executes,
            metadata: {},
          });
        }
      }
    }

    // Copy activity
    if (activityType === "Copy") {
      const inputs = (activity.inputs as unknown[]) ?? [];
      const outputs = (activity.outputs as unknown[]) ?? [];

      // inputs → uses_dataset (reads)
      for (const inp of inputs) {
        const i = inp as Record<string, unknown>;
        const refName = i.referenceName as string;
        edges.push({
          from: activityId,
          to: `${NodeType.Dataset}:${refName}`,
          type: EdgeType.UsesDataset,
          metadata: {},
        });

        // dataset params: table_name → reads_from table
        const params = i.parameters as Record<string, unknown> | undefined;
        if (params) {
          processDatasetParams(activityId, params, "reads_from", edges);
        }
      }

      // outputs → uses_dataset (writes)
      for (const out of outputs) {
        const o = out as Record<string, unknown>;
        const refName = o.referenceName as string;
        edges.push({
          from: activityId,
          to: `${NodeType.Dataset}:${refName}`,
          type: EdgeType.UsesDataset,
          metadata: {},
        });

        // dataset params: entity_name → writes_to dataverse_entity, table_name → writes_to table
        const params = o.parameters as Record<string, unknown> | undefined;
        if (params) {
          processDatasetParams(activityId, params, "writes_to", edges);
        }
      }

      // SQL reader query → reads_from table
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
      }
    }

    // SqlServerStoredProcedure
    if (activityType === "SqlServerStoredProcedure") {
      const spName = typeProperties?.storedProcedureName as string | undefined;
      if (spName) {
        const normalized = normalizeSpName(spName);
        edges.push({
          from: activityId,
          to: `${NodeType.StoredProcedure}:${normalized}`,
          type: EdgeType.CallsSp,
          metadata: {},
        });
      }
    }
  }

  return { nodes, edges, warnings };
}

function processDatasetParams(
  activityId: string,
  params: Record<string, unknown>,
  direction: "reads_from" | "writes_to",
  edges: GraphEdge[]
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
