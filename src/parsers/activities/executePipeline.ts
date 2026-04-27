import { GraphNode, GraphEdge, NodeType, EdgeType } from "../../graph/model.js";
import { ActivityContext } from "./base.js";

/**
 * Handle ExecutePipeline-specific logic:
 *   - Creates Executes edge from pipeline to child pipeline
 *   - Captures executedPipeline and pipelineParameters in activity metadata
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
  }

  return { edges, warnings };
}
