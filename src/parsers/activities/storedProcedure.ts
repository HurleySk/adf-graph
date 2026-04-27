import { GraphNode, GraphEdge, NodeType, EdgeType } from "../../graph/model.js";

function normalizeSpName(raw: string): string {
  // [dbo].[p_Transform_Org] -> dbo.p_Transform_Org
  return raw.replace(/\[/g, "").replace(/\]/g, "");
}

/**
 * Handle SqlServerStoredProcedure activity-specific logic:
 *   - Creates calls_sp edge to the stored procedure
 *   - Captures storedProcedureName and storedProcedureParameters in metadata
 */
export function parseStoredProcedureActivity(
  activity: Record<string, unknown>,
  activityNode: GraphNode,
): { edges: GraphEdge[]; warnings: string[] } {
  const edges: GraphEdge[] = [];
  const warnings: string[] = [];
  const activityId = activityNode.id;
  const typeProperties = activity.typeProperties as Record<string, unknown> | undefined;

  const spName = typeProperties?.storedProcedureName as string | undefined;
  if (spName) {
    const normalized = normalizeSpName(spName);
    edges.push({
      from: activityId,
      to: `${NodeType.StoredProcedure}:${normalized}`,
      type: EdgeType.CallsSp,
      metadata: {},
    });

    activityNode.metadata.storedProcedureName = normalized;
    const spParams = typeProperties?.storedProcedureParameters as Record<string, unknown> | undefined;
    if (spParams) {
      activityNode.metadata.storedProcedureParameters = spParams;
    }
  }

  return { edges, warnings };
}
