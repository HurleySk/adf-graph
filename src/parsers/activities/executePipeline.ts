import { GraphNode, GraphEdge, NodeType, EdgeType } from "../../graph/model.js";
import { ActivityContext } from "./base.js";
import { extractTablesFromSql } from "../parseResult.js";

/**
 * Handle ExecutePipeline-specific logic:
 *   - Creates Executes edge from pipeline to child pipeline
 *   - Captures executedPipeline and pipelineParameters in activity metadata
 *   - Extracts source tables from source_query and source_object_name parameters
 */
export function parseExecutePipeline(
  activity: Record<string, unknown>,
  activityNode: GraphNode,
  context: ActivityContext,
): { edges: GraphEdge[]; warnings: string[] } {
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];

  const activityName = activity.name as string;
  const typeProperties = activity.typeProperties as Record<string, unknown> | undefined;

  const refPipeline = typeProperties?.pipeline as Record<string, unknown> | undefined;
  const refName = refPipeline?.referenceName as string | undefined;
  if (refName) {
    if (refName.startsWith("@")) {
      warnings.push(`Dynamic pipeline reference in activity '${activityName}': ${refName}`);
    } else {
      edges.push({
        from: context.pipelineId,
        to: `${NodeType.Pipeline}:${refName}`,
        type: EdgeType.Executes,
        metadata: {},
      });
      activityNode.metadata.executedPipeline = refName;
    }
  }

  const execParams = typeProperties?.parameters as Record<string, unknown> | undefined;
  if (execParams && Object.keys(execParams).length > 0) {
    activityNode.metadata.pipelineParameters = execParams;

    // Extract source tables from source_query parameter
    const sourceQuery = execParams.source_query;
    let sqlText: string | null = null;
    if (typeof sourceQuery === "string") {
      sqlText = sourceQuery;
    } else if (sourceQuery && typeof sourceQuery === "object") {
      const q = sourceQuery as Record<string, unknown>;
      if (q.type === "Expression" && typeof q.value === "string") {
        sqlText = q.value;
      }
    }
    if (sqlText) {
      const tables = extractTablesFromSql(sqlText);
      for (const tbl of tables) {
        edges.push({
          from: activityNode.id,
          to: `${NodeType.Table}:${tbl}`,
          type: EdgeType.ReadsFrom,
          metadata: {},
        });
      }
    }

    // Extract source table from source_object_name parameter
    const sourceObjName = execParams.source_object_name;
    if (typeof sourceObjName === "string" && sourceObjName.length > 0 && !sourceObjName.startsWith("@")) {
      // Add dbo schema prefix if not already qualified
      const tableName = sourceObjName.includes(".") ? sourceObjName : `dbo.${sourceObjName}`;
      edges.push({
        from: activityNode.id,
        to: `${NodeType.Table}:${tableName}`,
        type: EdgeType.ReadsFrom,
        metadata: {},
      });
    }
  }

  return { edges, warnings };
}
