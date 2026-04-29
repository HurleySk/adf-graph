import { GraphNode, GraphEdge } from "../../graph/model.js";
import { ActivityContext, parseBaseActivity } from "./base.js";
import { parseExecutePipeline } from "./executePipeline.js";
import { parseCopyActivity } from "./copy.js";
import { parseStoredProcedureActivity } from "./storedProcedure.js";
import { parseContainerActivity, isContainerType } from "./container.js";
import { asString } from "../../utils/expressionValue.js";

export { ActivityContext } from "./base.js";
export { processDatasetParams } from "./copy.js";
export { isContainerType } from "./container.js";

export interface ActivityDispatchResult {
  node: GraphNode;
  innerNodes?: GraphNode[];
  edges: GraphEdge[];
  warnings: string[];
}

export function parseActivity(
  activity: Record<string, unknown>,
  context: ActivityContext,
): ActivityDispatchResult {
  const base = parseBaseActivity(activity, context);
  const node = base.node;
  const edges = [...base.edges];
  const warnings = [...base.warnings];
  let innerNodes: GraphNode[] | undefined;

  const activityType = activity.type as string;

  if (activityType === "ExecutePipeline") {
    const result = parseExecutePipeline(activity, node, context);
    edges.push(...result.edges);
    warnings.push(...result.warnings);
  } else if (activityType === "Copy") {
    const result = parseCopyActivity(activity, node);
    edges.push(...result.edges);
    warnings.push(...result.warnings);
  } else if (activityType === "SqlServerStoredProcedure") {
    const result = parseStoredProcedureActivity(activity, node);
    edges.push(...result.edges);
    warnings.push(...result.warnings);
  } else if (isContainerType(activityType)) {
    const result = parseContainerActivity(activity, node, context, parseActivity);
    innerNodes = result.innerNodes;
    edges.push(...result.edges);
    warnings.push(...result.warnings);
  }

  if (!node.metadata.sqlQuery) {
    const tp = activity.typeProperties as Record<string, unknown> | undefined;
    const src = tp?.source as Record<string, unknown> | undefined;
    const sql = asString(src?.sqlReaderQuery);
    if (sql) node.metadata.sqlQuery = sql;
  }

  return { node, innerNodes, edges, warnings };
}
