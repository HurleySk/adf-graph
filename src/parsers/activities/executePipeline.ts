import { GraphNode, GraphEdge, NodeType, EdgeType } from "../../graph/model.js";
import { ActivityContext } from "./base.js";
import { extractTablesFromSql } from "../parseResult.js";
import { asString, asNonDynamic } from "../../utils/expressionValue.js";
import { makePipelineId, makeNodeId, makeEntityId } from "../../utils/nodeId.js";

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
  const refName = asString(refPipeline?.referenceName);
  if (refName) {
    if (refName.startsWith("@")) {
      warnings.push(`Dynamic pipeline reference in activity '${activityName}': ${refName}`);
    } else {
      edges.push({
        from: context.pipelineId,
        to: makePipelineId(refName),
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
    const seenSourceTables = new Set<string>();
    const sqlText = asString(execParams.source_query) ?? null;
    if (sqlText) {
      const tables = extractTablesFromSql(sqlText);
      for (const tbl of tables) {
        const target = makeNodeId(NodeType.Table, tbl);
        seenSourceTables.add(target);
        edges.push({
          from: activityNode.id,
          to: target,
          type: EdgeType.ReadsFrom,
          metadata: {},
        });
      }
    }

    // Extract source table from source_object_name parameter (skip if already covered by source_query)
    const sourceObjName = asNonDynamic(execParams.source_object_name);
    if (sourceObjName) {
      const schema = asNonDynamic(execParams.source_schema_name) ?? "dbo";
      const tableName = sourceObjName.includes(".") ? sourceObjName : `${schema}.${sourceObjName}`;
      const target = makeNodeId(NodeType.Table, tableName);
      if (!seenSourceTables.has(target)) {
        edges.push({
          from: activityNode.id,
          to: target,
          type: EdgeType.ReadsFrom,
          metadata: {},
        });
      }
    }

    // Extract destination table from dest_object_name parameter
    const destObjName = asNonDynamic(execParams.dest_object_name);
    if (destObjName) {
      const schema = asNonDynamic(execParams.dest_schema_name) ?? "dbo";
      const tableName = destObjName.includes(".") ? destObjName : `${schema}.${destObjName}`;
      edges.push({
        from: activityNode.id,
        to: makeNodeId(NodeType.Table, tableName),
        type: EdgeType.WritesTo,
        metadata: {},
      });
    }

    // Extract Dataverse entity from dataverse_entity_name parameter
    const dvEntityName = asNonDynamic(execParams.dataverse_entity_name);
    if (dvEntityName) {
      edges.push({
        from: activityNode.id,
        to: makeEntityId(dvEntityName),
        type: EdgeType.WritesTo,
        metadata: {},
      });
    }
  }

  return { edges, warnings };
}
